// Load required packages
var mongoose = require('mongoose');

// Define our user schema (https://mongoosejs.com/docs/api/schema.html)
var UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    pendingTasks: [{ type: String }], // Array of task _id fields
    dateCreated: { type: Date, default: Date.now } // Automatically set by server
});

// Export the Mongoose model
module.exports = mongoose.model('User', UserSchema);
