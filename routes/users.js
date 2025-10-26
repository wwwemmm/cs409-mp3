// Load required packages
const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');

module.exports = function (router) {
    const usersRoute = router.route("/users");
    const usersIdRoute = router.route("/users/:id");

    // Helper function to build query from parameters
    function buildQuery(query, req) {
        // Handle where parameter
        if (req.query.where) {
            try {
                const whereClause = JSON.parse(req.query.where);
                query.where(whereClause);
            } catch (err) {
                throw new Error('Invalid where parameter');
            }
        }

        // Handle sort parameter
        if (req.query.sort) {
            try {
                const sortClause = JSON.parse(req.query.sort);
                query.sort(sortClause);
            } catch (err) {
                throw new Error('Invalid sort parameter');
            }
        }

        // Handle select parameter
        if (req.query.select) {
            try {
                const selectClause = JSON.parse(req.query.select);
                query.select(selectClause);
            } catch (err) {
                throw new Error('Invalid select parameter');
            }
        }

        // Handle skip parameter
        if (req.query.skip) {
            const skip = parseInt(req.query.skip);
            if (!isNaN(skip) && skip >= 0) {
                query.skip(skip);
            }
        }

        // Handle limit parameter
        if (req.query.limit) {
            const limit = parseInt(req.query.limit);
            if (!isNaN(limit) && limit > 0) {
                query.limit(limit);
            }
        }

        return query;
    }

    // GET /users - Respond with a list of users
    usersRoute.get(async function (req, res) {
        try {
            let query = User.find();
            query = buildQuery(query, req);

            // Handle count parameter
            if (req.query.count === 'true') {
                const count = await User.countDocuments(query.getQuery());
                return res.status(200).json({ 
                    message: "OK", 
                    data: count 
                });
            }

            const users = await query.exec();
            
            // Check if we're searching for a specific user by _id and no results found
            if (req.query.where) {
                try {
                    const whereClause = JSON.parse(req.query.where);
                    // If searching by _id and no results, return 404
                    if (whereClause._id && users.length === 0) {
                        return res.status(404).json({ 
                            message: "User not Found", 
                            data: "User not found" 
                        });
                    }
                } catch (err) {
                    // Invalid where clause, continue with normal flow
                }
            }
            
            res.status(200).json({ 
                message: "OK", 
                data: users 
            });
        } catch (err) {
            res.status(400).json({ 
                message: "Bad Request", 
                data: err.message 
            });
        }
    });

    // POST /users - Create a new user and respond with details of the new user
    usersRoute.post(async function (req, res) {
        try {
            // Validate required fields
            if (!req.body.name || !req.body.email) {
                return res.status(400).json({ 
                    message: "Bad Request", 
                    data: "Name and email are required" 
                });
            }

            // Validate pendingTasks format
            if (req.body.pendingTasks !== undefined && !Array.isArray(req.body.pendingTasks)) {
                return res.status(400).json({ 
                    message: "Bad Request", 
                    data: "pendingTasks must be an array" 
                });
            }

            // Validate pendingTasks if provided
            if (req.body.pendingTasks && Array.isArray(req.body.pendingTasks)) {
                // Validate all task IDs are valid ObjectIds
                for (const taskId of req.body.pendingTasks) {
                    if (!mongoose.Types.ObjectId.isValid(taskId)) {
                        return res.status(400).json({ 
                            message: "Bad Request", 
                            data: `Invalid task ID format: ${taskId}` 
                        });
                    }
                }

                // Validate all tasks exist
                for (const taskId of req.body.pendingTasks) {
                    const task = await Task.findById(taskId);
                    if (!task) {
                        return res.status(400).json({ 
                            message: "Bad Request", 
                            data: `Pending Task not found: ${taskId}` 
                        });
                    }
                }
            }

            // Create new user instance
            const newUser = new User(req.body);
            
            // Validate the user data
            const validationError = newUser.validateSync();
            if (validationError) {
                return res.status(400).json({ 
                    message: "Bad Request", 
                    data: validationError.message 
                });
            }

            // Save the user to database
            const savedUser = await newUser.save();
            let userToReturn = savedUser;
            
            // Update tasks to reference this user
            if (req.body.pendingTasks && Array.isArray(req.body.pendingTasks)) {
                for (const taskId of req.body.pendingTasks) {
                    // Remove this task from any OTHER user who currently has it in their pendingTasks
                    // Exclude the newly created user to avoid removing from itself
                    await User.updateMany(
                        { 
                            pendingTasks: taskId,
                            _id: { $ne: savedUser._id }
                        },
                        { $pull: { pendingTasks: taskId } }
                    );
                    
                    // Update task assignment
                    await Task.findByIdAndUpdate(taskId, {
                        assignedUser: savedUser._id.toString(),
                        assignedUserName: savedUser.name
                    });
                }
                
                // Reload the user to get the most up-to-date data
                userToReturn = await User.findById(savedUser._id);
            }
            
            // Respond with details of the new user
            res.status(201).json({ 
                message: "Created", 
                data: userToReturn 
            });
        } catch (err) {
            if (err.code === 11000) {
                // Duplicate key error (unique constraint violation)
                res.status(400).json({ 
                    message: "Bad Request", 
                    data: "User with this email already exists" 
                });
            } else {
                res.status(500).json({ 
                    message: "Internal Server Error", 
                    data: err.message 
                });
            }
        }
    });

    // GET /users/:id - Respond with details of specified user or 404 error
    usersIdRoute.get(async function (req, res) {
        try {
            const userId = req.params.id;
            
            // Check if userId is a valid ObjectId format
            if (!mongoose.Types.ObjectId.isValid(userId)) {
                return res.status(404).json({ 
                    message: "Not Found", 
                    data: "Invalid ID format provided for User" 
                });
            }
            
            let query = User.findById(userId);
            
            // Handle select parameter for single user
            if (req.query.select) {
                try {
                    const selectClause = JSON.parse(req.query.select);
                    query.select(selectClause);
                } catch (err) {
                    return res.status(400).json({ 
                        message: "Bad Request", 
                        data: "Invalid select parameter" 
                    });
                }
            }

            const user = await query.exec();
            
            if (!user) {
                return res.status(404).json({ 
                    message: "Not Found", 
                    data: "User not found" 
                });
            }

            res.status(200).json({ 
                message: "OK", 
                data: user 
            });
        } catch (err) {
            res.status(500).json({ 
                message: "Internal Server Error", 
                data: err.message 
            });
        }
    });

    // PUT /users/:id - Replace entire user with supplied user or 404 error
    usersIdRoute.put(async function (req, res) {
        try {
            const userId = req.params.id;
            
            // Check if userId is a valid ObjectId format
            if (!mongoose.Types.ObjectId.isValid(userId)) {
                return res.status(404).json({ 
                    message: "Not Found", 
                    data: "Invalid ID format provided for User" 
                });
            }
            
            // Validate required fields
            if (!req.body.name || !req.body.email) {
                return res.status(400).json({ 
                    message: "Bad Request", 
                    data: "Name and email are required" 
                });
            }

            // Validate pendingTasks format
            if (req.body.pendingTasks !== undefined && !Array.isArray(req.body.pendingTasks)) {
                return res.status(400).json({ 
                    message: "Bad Request", 
                    data: "pendingTasks must be an array" 
                });
            }

            // Find the existing user
            const existingUser = await User.findById(userId);
            if (!existingUser) {
                return res.status(404).json({ 
                    message: "Not Found", 
                    data: "User not found" 
                });
            }

            // Handle pendingTasks two-way reference
            if (req.body.pendingTasks && Array.isArray(req.body.pendingTasks)) {
                // Validate all task IDs are valid ObjectIds
                for (const taskId of req.body.pendingTasks) {
                    if (!mongoose.Types.ObjectId.isValid(taskId)) {
                        return res.status(400).json({ 
                            message: "Bad Request", 
                            data: `Pending Task not found: ${taskId}` 
                        });
                    }
                }

                // Get all new tasks to be assigned to this user
                const newTaskIds = new Set(req.body.pendingTasks);
                const oldTaskIds = new Set(existingUser.pendingTasks || []);

                // For each new task, check if it needs to be transferred from another user
                for (const taskId of newTaskIds) {
                    // Validate task exists
                    const task = await Task.findById(taskId);
                    if (!task) {
                        return res.status(400).json({ 
                            message: "Bad Request", 
                            data: `Pending Task not found: ${taskId}` 
                        });
                    }
                    
                    // Remove this task from any user who currently has it in their pendingTasks
                    // This ensures we clean up any inconsistencies
                    await User.updateMany(
                        { pendingTasks: taskId },
                        { $pull: { pendingTasks: taskId } }
                    );
                    
                    // Update task assignment
                    await Task.findByIdAndUpdate(taskId, {
                        assignedUser: userId,
                        assignedUserName: req.body.name
                    });
                }

                // For tasks that are being removed from this user, unassign them
                for (const taskId of oldTaskIds) {
                    if (!newTaskIds.has(taskId)) {
                        await Task.findByIdAndUpdate(taskId, {
                            assignedUser: "",
                            assignedUserName: "unassigned"
                        });
                    }
                }
            }

            // Find and update user
            const updatedUser = await User.findByIdAndUpdate(
                userId, 
                req.body, 
                { new: true, runValidators: true }
            );

            // Update assignedUserName in all tasks assigned to this user
            await Task.updateMany(
                { assignedUser: userId },
                { assignedUserName: updatedUser.name }
            );

            res.status(200).json({ 
                message: "OK", 
                data: updatedUser 
            });
        } catch (err) {
            if (err.code === 11000) {
                res.status(400).json({ 
                    message: "Bad Request", 
                    data: "User with this email already exists" 
                });
            } else if (err.message && err.message.includes("Cast to ObjectId failed")) {
                res.status(400).json({ 
                    message: "Bad Request", 
                    data: err.message 
                });
            } else {
                res.status(500).json({ 
                    message: "Internal Server Error", 
                    data: err.message 
                });
            }
        }
    });

    // DELETE /users/:id - Delete specified user or 404 error
    usersIdRoute.delete(async function (req, res) {
        try {
            const userId = req.params.id;
            
            // Check if userId is a valid ObjectId format
            if (!mongoose.Types.ObjectId.isValid(userId)) {
                return res.status(404).json({ 
                    message: "Not Found", 
                    data: "Invalid ID format provided for User" 
                });
            }
            
            // Find user first
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ 
                    message: "Not Found", 
                    data: "User not found" 
                });
            }

            // Unassign all tasks assigned to this user
            await Task.updateMany(
                { assignedUser: userId },
                { 
                    assignedUser: "", 
                    assignedUserName: "unassigned" 
                }
            );

            // Delete the user
            await User.findByIdAndDelete(userId);

            res.status(204).json({ 
                message: "No Content", 
                data: null 
            });
        } catch (err) {
            res.status(500).json({ 
                message: "Internal Server Error", 
                data: err.message 
            });
        }
    });

    return router;
};