const mongoose = require('mongoose');
const studentSchema = require('../models/Student'); // Student Schema ကို ယူမည်

// အခြား Schema များရှိလျှင်လည်း Import လုပ်ပါ
const classroomSchema = require('../models/Classroom');
const enrollmentSchema = require('../models/Enrollment');
const paymentSchema = require('../models/Payment');
const staffSchema = require('../models/Staff');

const tenantMiddleware = async (req, res, next) => {
  try {
    if (!req.session.user || !req.session.user.tenantId) {
      return res.redirect('/login');
    }

    const tenantId = req.session.user.tenantId;

    // Tenant Database Connection တည်ဆောက်ခြင်း
    const tenantConn = mongoose.createConnection(`mongodb://127.0.0.1:27017/${tenantId}`);

    // Model များကို Schema နှင့်တကွ Register လုပ်ပေးခြင်း
    req.Student = tenantConn.model('Student', studentSchema);
    req.Classroom = tenantConn.model('Classroom', classroomSchema.schema || classroomSchema);
    req.Enrollment = tenantConn.model('Enrollment', enrollmentSchema.schema || enrollmentSchema);
    req.Payment = tenantConn.model('Payment', paymentSchema.schema || paymentSchema);
    req.Staff = tenantConn.model('Staff', staffSchema.schema || staffSchema);

    next();
  } catch (err) {
    res.status(500).send('Tenant Connection Error: ' + err.message);
  }
};

module.exports = tenantMiddleware;