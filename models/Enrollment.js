const mongoose = require('mongoose');

const enrollmentSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  course: { type: String, required: true },
  className: { type: String, required: true },
  startDate: { type: Date, required: true },
  courseFee: { type: Number, required: true },
  initialPaid: { type: Number, required: true },
  remainingBalance: { type: Number, required: true },
  paymentMethod: { type: String, required: true },
  // NOTE: 'Partial' အစား 'Credit' ဟု Enum သို့ ပြောင်းလဲထားပါသည်
  paymentStatus: { type: String, required: true, enum: ['Paid', 'Credit', 'Unpaid'] }
}, {
  timestamps: true
});

module.exports = mongoose.model('Enrollment', enrollmentSchema);