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
            
            // Respond with details of the new user
            res.status(201).json({ 
                message: "Created", 
                data: savedUser 
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
                // Remove tasks from previous assignment if they're being reassigned
                for (const taskId of existingUser.pendingTasks || []) {
                    if (!req.body.pendingTasks.includes(taskId)) {
                        // Task is being removed from this user's pendingTasks
                        await Task.findByIdAndUpdate(taskId, {
                            assignedUser: "",
                            assignedUserName: "unassigned"
                        });
                    }
                }

                // Add tasks to new assignment
                for (const taskId of req.body.pendingTasks) {
                    // Validate task exists
                    const task = await Task.findById(taskId);
                    if (task) {
                        await Task.findByIdAndUpdate(taskId, {
                            assignedUser: userId,
                            assignedUserName: req.body.name
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