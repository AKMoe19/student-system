const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  student: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Student', 
    required: true 
  },
  enrollment: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Enrollment', 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  paymentType: { 
    type: String, 
    enum: ['Initial', 'Debt Payment', 'Balance Pay'],
    default: 'Initial' 
  },
  paymentMethod: { 
    type: String, 
    required: true 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

module.exports = mongoose.model('Payment', paymentSchema);