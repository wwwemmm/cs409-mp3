// Load required packages
const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');

module.exports = function (router) {
    const tasksRoute = router.route("/tasks");
    const tasksIdRoute = router.route("/tasks/:id");

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

        // Handle limit parameter (default 100 for tasks)
        if (req.query.limit) {
            const limit = parseInt(req.query.limit);
            if (!isNaN(limit) && limit > 0) {
                query.limit(limit);
            }
        } else {
            query.limit(100); // Default limit for tasks
        }

        return query;
    }

    // GET /tasks - Respond with a list of tasks
    tasksRoute.get(async function (req, res) {
        try {
            let query = Task.find();
            query = buildQuery(query, req);

            // Handle count parameter
            if (req.query.count === 'true') {
                const count = await Task.countDocuments(query.getQuery());
                return res.status(200).json({ 
                    message: "OK", 
                    data: count 
                });
            }

            const tasks = await query.exec();
            res.status(200).json({ 
                message: "OK", 
                data: tasks 
            });
        } catch (err) {
            res.status(400).json({ 
                message: "Bad Request", 
                data: err.message 
            });
        }
    });

    // POST /tasks - Create a new task and respond with details of the new task
    tasksRoute.post(async function (req, res) {
        try {
            // Validate required fields
            if (!req.body.name || !req.body.deadline) {
                return res.status(400).json({ 
                    message: "Bad Request", 
                    data: "Name and deadline are required" 
                });
            }

            // Create new task instance
            const newTask = new Task(req.body);
            
            // Validate the task data
            const validationError = newTask.validateSync();
            if (validationError) {
                return res.status(400).json({ 
                    message: "Bad Request", 
                    data: validationError.message 
                });
            }

            // If assignedUser is provided, validate it exists and update assignedUserName
            if (newTask.assignedUser) {
                // Check if assignedUser is a valid ObjectId format
                if (!mongoose.Types.ObjectId.isValid(newTask.assignedUser)) {
                    return res.status(400).json({ 
                        message: "Bad Request", 
                        data: "Assigned user not found" 
                    });
                }
                
                const user = await User.findById(newTask.assignedUser);
                if (user) {
                    newTask.assignedUserName = user.name;
                    // Add task to user's pendingTasks only if not completed
                    if (!newTask.completed) {
                        await User.findByIdAndUpdate(
                            newTask.assignedUser,
                            { $addToSet: { pendingTasks: newTask._id.toString() } }
                        );
                    }
                } else {
                    return res.status(400).json({ 
                        message: "Bad Request", 
                        data: "Assigned user not found" 
                    });
                }
            }

            // Save the task to database
            const savedTask = await newTask.save();
            
            // Respond with details of the new task
            res.status(201).json({ 
                message: "Created", 
                data: savedTask 
            });
        } catch (err) {
            if (err.message && err.message.includes("Cast to ObjectId failed")) {
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

    // GET /tasks/:id - Respond with details of specified task or 404 error
    tasksIdRoute.get(async function (req, res) {
        try {
            const taskId = req.params.id;
            
            // Check if taskId is a valid ObjectId format
            if (!mongoose.Types.ObjectId.isValid(taskId)) {
                return res.status(404).json({ 
                    message: "Not Found", 
                    data: "Invalid ID format provided for Task" 
                });
            }
            
            let query = Task.findById(taskId);
            
            // Handle select parameter for single task
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

            const task = await query.exec();
            
            if (!task) {
                return res.status(404).json({ 
                    message: "Not Found", 
                    data: "Task not found" 
                });
            }

            res.status(200).json({ 
                message: "OK", 
                data: task 
            });
        } catch (err) {
            res.status(500).json({ 
                message: "Internal Server Error", 
                data: err.message 
            });
        }
    });

    // PUT /tasks/:id - Replace entire task with supplied task or 404 error
    tasksIdRoute.put(async function (req, res) {
        try {
            const taskId = req.params.id;
            
            // Check if taskId is a valid ObjectId format
            if (!mongoose.Types.ObjectId.isValid(taskId)) {
                return res.status(404).json({ 
                    message: "Not Found", 
                    data: "Invalid ID format provided for Task" 
                });
            }
            
            // Validate required fields
            if (!req.body.name || !req.body.deadline) {
                return res.status(400).json({ 
                    message: "Bad Request", 
                    data: "Name and deadline are required" 
                });
            }

            // Find the existing task
            const existingTask = await Task.findById(taskId);
            if (!existingTask) {
                return res.status(404).json({ 
                    message: "Not Found", 
                    data: "Task not found" 
                });
            }

            // Determine if the assignedUser is changing
            const newAssignedUser = req.body.assignedUser;
            const isAssignedUserChanging = newAssignedUser !== existingTask.assignedUser;

            // If new assignedUser is provided, validate it exists and update assignedUserName
            if (req.body.assignedUser) {
                // Check if assignedUser is a valid ObjectId format
                if (!mongoose.Types.ObjectId.isValid(req.body.assignedUser)) {
                    return res.status(400).json({ 
                        message: "Bad Request", 
                        data: "Assigned user not found" 
                    });
                }
                
                const user = await User.findById(req.body.assignedUser);
                if (!user) {
                    return res.status(400).json({ 
                        message: "Bad Request", 
                        data: "Assigned user not found" 
                    });
                }
                
                // Validate assignedUserName if provided
                if (req.body.assignedUserName && req.body.assignedUserName !== user.name) {
                    return res.status(400).json({ 
                        message: "Bad Request", 
                        data: "Assigned user name does not match the provided user" 
                    });
                }
                
                // Set assignedUserName to the actual user's name
                req.body.assignedUserName = user.name;
            } else {
                // If assignedUser is not provided, ignore assignedUserName
                req.body.assignedUser = "";
                req.body.assignedUserName = "unassigned";
            }

            // Handle task assignment and completion status changes
            if (isAssignedUserChanging) {
                // Remove task from old user's pendingTasks
                if (existingTask.assignedUser) {
                    await User.findByIdAndUpdate(
                        existingTask.assignedUser,
                        { $pull: { pendingTasks: taskId } }
                    );
                }
                
                // Add task to new user's pendingTasks only if not completed
                if (req.body.assignedUser && !req.body.completed) {
                    await User.findByIdAndUpdate(
                        req.body.assignedUser,
                        { $addToSet: { pendingTasks: taskId } }
                    );
                }
            } else {
                // AssignedUser is not changing, just handle completion status
                const targetUser = req.body.assignedUser || existingTask.assignedUser;
                
                if (targetUser) {
                    if (req.body.completed === true && !existingTask.completed) {
                        // Task is being marked as completed, remove from user's pendingTasks
                        await User.findByIdAndUpdate(
                            targetUser,
                            { $pull: { pendingTasks: taskId } }
                        );
                    } else if (req.body.completed === false && existingTask.completed) {
                        // Task is being marked as not completed, add back to user's pendingTasks
                        await User.findByIdAndUpdate(
                            targetUser,
                            { $addToSet: { pendingTasks: taskId } }
                        );
                    }
                }
            }

            // Update the task
            const updatedTask = await Task.findByIdAndUpdate(
                taskId, 
                req.body, 
                { new: true, runValidators: true }
            );

            res.status(200).json({ 
                message: "OK", 
                data: updatedTask 
            });
        } catch (err) {
            if (err.message && err.message.includes("Cast to ObjectId failed")) {
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

    // DELETE /tasks/:id - Delete specified task or 404 error
    tasksIdRoute.delete(async function (req, res) {
        try {
            const taskId = req.params.id;
            
            // Check if taskId is a valid ObjectId format
            if (!mongoose.Types.ObjectId.isValid(taskId)) {
                return res.status(404).json({ 
                    message: "Not Found", 
                    data: "Invalid ID format provided for Task" 
                });
            }
            
            // Find task first
            const task = await Task.findById(taskId);
            if (!task) {
                return res.status(404).json({ 
                    message: "Not Found", 
                    data: "Task not found" 
                });
            }

            // Remove task from user's pendingTasks if it was assigned
            if (task.assignedUser) {
                await User.findByIdAndUpdate(
                    task.assignedUser,
                    { $pull: { pendingTasks: taskId } }
                );
            }

            // Delete the task
            await Task.findByIdAndDelete(taskId);

            res.status(204).json({ 
                message: "No Content", 
                data: null 
            });
        } catch (err) {
            if (err.message && err.message.includes("Cast to ObjectId failed")) {
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

    return router;
};
