const mongoose = require('mongoose');

const classroomSchema = new mongoose.Schema({
  className: { type: String, required: true },
  course: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  studentLimit: { type: Number, required: true, default: 10 },
  trainer: { type: String, default: 'Unknown' }
}, { timestamps: true });

module.exports = mongoose.model('Classroom', classroomSchema);