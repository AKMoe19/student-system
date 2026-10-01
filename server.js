const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const session = require('express-session');

const CentralUser = require('./models/CentralUser');
const studentSchema = require('./models/Student');
const staffSchema = require('./models/Staff');
const tenantMiddleware = require('./middleware/tenant');

dotenv.config();
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: 'school_management_secret_key',
  resave: false,
  saveUninitialized: false
}));

// Helper function: Student ID ထုတ်ပေးရန်
async function generateStudentId(StudentModel) {
  const currentYear = new Date().getFullYear();
  const count = await StudentModel.countDocuments();
  return `STU-${currentYear}-${(count + 1).toString().padStart(4, '0')}`;
}

// Helper function: Staff Model ကို ဘေးကင်းစွာ ရယူရန်
function getStaffModel(req) {
  if (req.Staff) return req.Staff;
  if (req.tenantConn) return req.tenantConn.model('Staff', staffSchema.schema || staffSchema);
  return mongoose.model('Staff', staffSchema.schema || staffSchema);
}

// ==========================================
// 🛡️ ROLE-BASED AUTHORIZATION MIDDLEWARES
// ==========================================

// ၁။ Login ဝင်ထားခြင်း ရှိ/မရှိ စစ်ဆေးခြင်း
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// ၂။ Student Role ဖြစ်ပါက မိမိ Profile ကလွဲ၍ အခြားနေရာများသို့ ဝင်ခွင့်မပြုခြင်း
function restrictStudentAccess(req, res, next) {
  if (req.session.user && req.session.user.role === 'Student') {
    return res.redirect('/student/profile');
  }
  next();
}

// ၃။ Admin သို့မဟုတ် Staff များသာ Access ပေးရန် မစ်ဒယ်ဝဲ
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }
    if (!allowedRoles.includes(req.session.user.role)) {
      return res.status(403).send('Access Denied: သင်၏ Role ဖြင့် ဤစာမျက်နှာကို ကြည့်ရှုခွင့်မရှိပါ။');
    }
    next();
  };
}

// ==========================================
// 🔐 AUTHENTICATION & REGISTER ROUTES
// ==========================================

app.get('/login', (req, res) => {
  if (req.session.user) {
    if (req.session.user.role === 'Student') {
      return res.redirect('/student/profile');
    }
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

// LOGIN LOGIC: Admin, Staff သို့မဟုတ် Student စစ်ဆေးခြင်း
app.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const loginIdentifier = (email || username || '').trim().toLowerCase();

    if (!loginIdentifier || !password) {
      return res.render('login', { error: 'Email/Username နှင့် Password ဖြည့်သွင်းရန် လိုအပ်ပါသည်။' });
    }

    // ၁။ Central DB တွင် Admin အကောင့် ဟုတ်/မဟုတ် စစ်ဆေးခြင်း
    const adminUser = await CentralUser.findOne({
      $or: [{ email: loginIdentifier }, { username: loginIdentifier }]
    });

    if (adminUser) {
      if (adminUser.password !== password) {
        return res.render('login', { error: 'Email/Username သို့မဟုတ် Password မှားယွင်းနေပါသည်။' });
      }

      req.session.user = {
        id: adminUser._id,
        email: adminUser.email,
        username: adminUser.username,
        role: adminUser.role, // 'Admin'
        tenantId: adminUser.tenantId
      };
      return res.redirect('/');
    }

    // ၂။ Tenant DB များထဲတွင် Staff သို့မဟုတ် Student အကောင့် စစ်ဆေးခြင်း
    const adminUsers = await CentralUser.find({ role: 'Admin' });
    const tenantIds = [...new Set(adminUsers.map(u => u.tenantId))];

    for (const tenantId of tenantIds) {
      const tenantConn = mongoose.createConnection(`mongodb://127.0.0.1:27017/${tenantId}`);
      try {
        const StudentModel = tenantConn.model('Student', studentSchema);
        const StaffModel = tenantConn.model('Staff', staffSchema.schema || staffSchema);

        // (က) Staff / Trainer စစ်ဆေးခြင်း
        const staff = await StaffModel.findOne({ email: loginIdentifier });
        if (staff && staff.password && staff.password === password) {
          if (staff.status === 'Inactive') {
            return res.render('login', { error: 'ဤအကောင့်မှာ ပိတ်ထားပြီးဖြစ်ပါသည်။ Admin ထံ ဆက်သွယ်ပါ။' });
          }

          req.session.user = {
            id: staff._id,
            email: staff.email,
            username: staff.name,
            role: staff.role, // 'Office Staff' သို့မဟုတ် 'Trainer'
            tenantId: tenantId
          };
          return res.redirect('/');
        }

        // (ခ) Student စစ်ဆေးခြင်း
        const student = await StudentModel.findOne({ email: loginIdentifier });
        if (student && student.password && student.password === password) {
          req.session.user = {
            id: student._id,
            email: student.email,
            username: student.name,
            role: 'Student',
            tenantId: tenantId
          };
          return res.redirect('/student/profile'); // Student မို့လို့ Profile သို့ တိုက်ရိုက် Redirect လုပ်သည်
        }
      } finally {
        await tenantConn.close();
      }
    }

    return res.render('login', { error: 'Email/Username သို့မဟုတ် Password မှားယွင်းနေပါသည်။' });

  } catch (err) {
    res.render('login', { error: 'Server Error: ' + err.message });
  }
});

app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

// REGISTER LOGIC: Tenant DB ထဲရှိ Student Record တွင် Password သိမ်းဆည်းခြင်း
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanEmail || !password) {
      return res.render('register', { error: 'Email နှင့် Password ဖြည့်သွင်းရန် လိုအပ်ပါသည်။' });
    }

    const adminUsers = await CentralUser.find({ role: 'Admin' });
    const tenantIds = [...new Set(adminUsers.map(u => u.tenantId))];

    let matchedStudent = null;
    let activeConn = null;

    for (const tenantId of tenantIds) {
      const tenantConn = mongoose.createConnection(`mongodb://127.0.0.1:27017/${tenantId}`);
      try {
        const StudentModel = tenantConn.model('Student', studentSchema);
        const foundStudent = await StudentModel.findOne({ email: cleanEmail });

        if (foundStudent) {
          matchedStudent = foundStudent;
          activeConn = tenantConn;
          break;
        }
      } catch (err) {
        await tenantConn.close();
        throw err;
      }
    }

    if (!matchedStudent) {
      return res.render('register', { 
        error: 'မည်သည့်ကျောင်းတွင်မျှ ဒီ Email ဖြင့် ကျောင်းသားစာရင်း မတွေ့ရှိပါ။ ကျေးဇူးပြု၍ စာရင်းသွင်းထားသော Email ဖြင့် ပြန်လည်ကြိုးစားပါ။' 
      });
    }

    if (matchedStudent.password) {
      if (activeConn) await activeConn.close();
      return res.render('register', { error: 'ဒီ Email ဖြင့် အကောင့်ဖွင့်ပြီးဖြစ်သည်။ Login ဝင်ပါ။' });
    }

    matchedStudent.password = password;
    await matchedStudent.save();
    if (activeConn) await activeConn.close();

    res.render('login', { error: null });

  } catch (err) {
    res.render('register', { error: 'Server Error: ' + err.message });
  }
});


// ==========================================
// 👤 STUDENT PROFILE ROUTE
// ==========================================
app.get('/student/profile', requireAuth, tenantMiddleware, async (req, res) => {
  try {
    const userId = req.session.user._id || req.session.user.id;
    
    // ကျောင်းသားအချက်အလက် ရှာခြင်း
    const student = await req.Student.findOne({ 
      $or: [{ _id: userId }, { studentId: req.session.user.studentId }] 
    });

    if (!student) {
      return res.status(404).send('Student profile not found');
    }

    const rawEnrollments = await req.Enrollment.find({ student: student._id }).lean();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 🔴 Classroom ၏ endDate ကို စစ်ဆေးပြီး classroomStatus သတ်မှတ်ခြင်း
    const enrollments = await Promise.all(rawEnrollments.map(async (item) => {
      const cls = await req.Classroom.findOne({ className: item.className }).lean();
      
      let classroomStatus = 'Processing';
      if (cls && cls.endDate) {
        const clsEndDate = new Date(cls.endDate);
        clsEndDate.setHours(23, 59, 59, 999);
        
        if (today >= clsEndDate) {
          classroomStatus = 'Completed';
        }
      }

      return {
        ...item,
        classroomStatus
      };
    }));

    const payments = await req.Payment.find({ student: student._id }).sort({ createdAt: -1 });

    const summary = {
      totalFees: enrollments.reduce((acc, curr) => acc + (curr.courseFee || 0), 0),
      totalPaid: enrollments.reduce((acc, curr) => acc + (curr.initialPaid || 0), 0),
      totalRemaining: enrollments.reduce((acc, curr) => acc + (curr.remainingBalance || 0), 0)
    };

    res.render('student-profile', {
      student,
      enrollments,
      payments,
      summary,
      user: req.session.user
    });
  } catch (err) {
    res.status(500).send('Server Error: ' + err.message);
  }
});


// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ==========================================
// 🏠 HOME & DASHBOARD (ADMIN & STAFF ONLY)
// ==========================================

// app.get('/', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
//   try {
//     // Trainer ဖြစ်ပါက Classrooms စာမျက်နှာသို့ လမ်းကြောင်းလွှဲမည်
//     if (req.session.user.role === 'Trainer') {
//       return res.redirect('/classrooms');
//     }

//     const { searchId } = req.query;
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     let filter = {};

//     if (searchId && searchId.trim() !== '') {
//       const matchedStudents = await req.Student.find({
//         $or: [
//           { studentId: { $regex: searchId.trim(),$options: 'i' } },
//           { name: { $regex: searchId.trim(),$options: 'i' } },
//           { phone: { $regex: searchId.trim(),$options: 'i' } }
//         ]
//       });
//       const studentIds = matchedStudents.map(s => s._id);
//       filter = { student: { $in: studentIds } };
//     } else {
//       filter = { startDate: { $gt: today } };
//     }

//     const enrollments = await req.Enrollment.find(filter)
//       .populate('student')
//       .sort({ createdAt: -1 });

//     const existingStudents = await req.Student.find().sort({ name: 1 });
    
//     const classroomsRaw = await req.Classroom.find().sort({ className: 1 }).lean();
//     const classrooms = await Promise.all(classroomsRaw.map(async (cls) => {
//       const currentEnrolled = await req.Enrollment.countDocuments({ className: cls.className });
//       return {
//         ...cls,
//         currentEnrolled
//       };
//     }));

//     res.render('index', { 
//       enrollments, 
//       existingStudents, 
//       classrooms, 
//       searchId: searchId || '',
//       user: req.session.user,
//       activePage: 'enrollments'
//     });
//   } catch (err) {
//     res.status(500).send('Server Error: ' + err.message);
//   }
// });

app.get('/', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
  try {
    if (req.session.user.role === 'Trainer') {
      return res.redirect('/classrooms');
    }

    const { searchId } = req.query;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let filter = {};

    if (searchId && searchId.trim() !== '') {
      const matchedStudents = await req.Student.find({
        $or: [
          { studentId: { $regex: searchId.trim(), $options: 'i' } },
          { name: { $regex: searchId.trim(), $options: 'i' } },
          { phone: { $regex: searchId.trim(), $options: 'i' } }
        ]
      });
      const studentIds = matchedStudents.map(s => s._id);
      filter = { student: { $in: studentIds } };
    } else {
      filter = { startDate: { $gte: today } };
    }

    const rawEnrollments = await req.Enrollment.find(filter)
      .populate('student')
      .sort({ createdAt: -1 })
      .lean();

    // Classroom ၏ endDate နှင့် နှိုင်းယှဉ်၍ StatusBadge (New, Processing, Completed) သတ်မှတ်ခြင်း
    const enrollments = await Promise.all(rawEnrollments.map(async (item) => {
      const cls = await req.Classroom.findOne({ className: item.className }).lean();
      
      const startDate = new Date(item.startDate);
      startDate.setHours(0, 0, 0, 0);

      const endDate = cls && cls.endDate ? new Date(cls.endDate) : null;
      if (endDate) endDate.setHours(0, 0, 0, 0);

      let classStatus = 'Processing';
      if (startDate > today) {
        classStatus = 'New';
      } else if (endDate && today > endDate) {
        classStatus = 'Completed';
      }

      return {
        ...item,
        classStatus
      };
    }));

    const existingStudents = await req.Student.find().sort({ name: 1 });
    
    const classroomsRaw = await req.Classroom.find().sort({ className: 1 }).lean();
    const classrooms = await Promise.all(classroomsRaw.map(async (cls) => {
      const currentEnrolled = await req.Enrollment.countDocuments({ className: cls.className });
      return {
        ...cls,
        currentEnrolled
      };
    }));

    res.render('index', { 
      enrollments, 
      existingStudents, 
      classrooms, 
      searchId: searchId || '',
      user: req.session.user,
      activePage: 'enrollments'
    });
  } catch (err) {
    res.status(500).send('Server Error: ' + err.message);
  }
});

// ==========================================
// 💳 PAYMENT HISTORY ROUTE
// ==========================================

app.get('/payments', requireAuth, authorizeRoles('Admin', 'Office Staff'), tenantMiddleware, async (req, res) => {
  try {
    const { search, date, month, year } = req.query;
    let filter = {};

    if (search && search.trim() !== '') {
      const matchedStudents = await req.Student.find({
        $or: [
          { studentId: { $regex: search.trim(),$options: 'i' } },
          { name: { $regex: search.trim(),$options: 'i' } }
        ]
      });
      const studentIds = matchedStudents.map(s => s._id);

      const matchedEnrollments = await req.Enrollment.find({
        course: { $regex: search.trim(),$options: 'i' }
      });
      const enrollmentIds = matchedEnrollments.map(e => e._id);

      filter.$or = [
        { student: { $in: studentIds } },
        { enrollment: { $in: enrollmentIds } }
      ];
    }

    let dateFilter = {};
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      dateFilter.$gte = startDate;
      dateFilter.$lte = endDate;
    } else if (year || month) {
      const currentYear = year ? parseInt(year) : new Date().getFullYear();
      let startMonth = month ? parseInt(month) - 1 : 0;
      let endMonth = month ? parseInt(month) - 1 : 11;

      const startDate = new Date(currentYear, startMonth, 1, 0, 0, 0, 0);
      const endDate = new Date(currentYear, endMonth + 1, 0, 23, 59, 59, 999);

      dateFilter.$gte = startDate;
      dateFilter.$lte = endDate;
    }

    if (Object.keys(dateFilter).length > 0) {
      filter.createdAt = dateFilter;
    }

    const payments = await req.Payment.find(filter)
      .populate('student')
      .populate('enrollment')
      .sort({ createdAt: -1 });

    const totalAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

    res.render('payments', {
      payments,
      totalAmount,
      search: search || '',
      selectedDate: date || '',
      selectedMonth: month || '',
      selectedYear: year || '',
      user: req.session.user,
      activePage: 'payments'
    });
  } catch (err) {
    res.status(500).send('Server Error: ' + err.message);
  }
});

// ==========================================
// 🏫 CLASSROOM ROUTES
// ==========================================

app.get('/classrooms', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
  try {
    let query = {};
    
    // Trainer ဖြစ်ပါက မိမိ သင်ကြားရမည့် Class များကိုသာ ပြမည်
    if (req.session.user.role === 'Trainer') {
      query = { trainer: req.session.user.username };
    }

    const classrooms = await req.Classroom.find(query).sort({ createdAt: -1 }).lean();

    const classroomsWithCount = await Promise.all(classrooms.map(async (cls) => {
      const currentEnrolled = await req.Enrollment.countDocuments({ className: cls.className });
      return {
        ...cls,
        currentEnrolled
      };
    }));

    // Database ထဲမှ Active ဖြစ်နေသော Trainer အကောင့်များကို ဆွဲထုတ်ခြင်း
    const StaffModel = getStaffModel(req);
    const trainers = await StaffModel.find({ role: 'Trainer', status: 'Active' }).sort({ name: 1 }).lean();

    // trainers စာရင်းကို View သို့ Pass လုပ်ပေးမည်
    res.render('classrooms', { 
      classrooms: classroomsWithCount, 
      trainers, 
      user: req.session.user,
      activePage: 'classrooms' 
    });
  } catch (err) {
    res.status(500).send('Server Error: ' + err.message);
  }
});

app.get('/api/classrooms', requireAuth, tenantMiddleware, async (req, res) => {
  try {
    const classrooms = await req.Classroom.find().sort({ className: 1 });
    res.json(classrooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/create-classroom', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
  try {
    const { className, course, startDate, endDate, studentLimit } = req.body;
    await req.Classroom.create({ 
      className, 
      course, 
      startDate, 
      endDate, 
      studentLimit: parseInt(studentLimit) || 10 
    });
    res.redirect('/classrooms');
  } catch (err) {
    res.status(500).send('Error creating classroom: ' + err.message);
  }
});

app.get('/api/classroom/:id', requireAuth, tenantMiddleware, async (req, res) => {
  try {
    const classroom = await req.Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });
    res.json(classroom);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/edit-classroom/:id', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
  try {
    const { className, course, startDate, endDate, studentLimit, trainer } = req.body;
    await req.Classroom.findByIdAndUpdate(req.params.id, { 
      className, 
      course, 
      startDate, 
      endDate, 
      studentLimit: parseInt(studentLimit) || 10,
      trainer: trainer || 'Unknown'
    });
    res.redirect('/classrooms');
  } catch (err) {
    res.status(500).send('Error updating classroom: ' + err.message);
  }
});

app.post('/delete-classroom/:id', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
  try {
    await req.Classroom.findByIdAndDelete(req.params.id);
    res.redirect('/classrooms');
  } catch (err) {
    res.status(500).send('Error deleting classroom: ' + err.message);
  }
});

app.post('/start-classroom/:id', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
  try {
    const { trainer } = req.body;
    await req.Classroom.findByIdAndUpdate(req.params.id, { 
      trainer: trainer || 'Unknown' 
    });
    res.redirect('/classrooms');
  } catch (err) {
    res.status(500).send('Error starting classroom: ' + err.message);
  }
});

app.get('/classroom/:id/students', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
  try {
    const classroom = await req.Classroom.findById(req.params.id);
    if (!classroom) {
      return res.status(404).send('Classroom မတွေ့ရှိပါ။');
    }

    const enrollments = await req.Enrollment.find({ className: classroom.className })
      .populate('student')
      .sort({ createdAt: -1 });

    res.render('classroom-students', { 
      classroom, 
      enrollments, 
      user: req.session.user,
      activePage: 'classrooms' 
    });
  } catch (err) {
    res.status(500).send('Error loading classroom students: ' + err.message);
  }
});

app.post('/change-enrollment-class/:enrollmentId', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
  try {
    const { newClassName } = req.body;
    const { enrollmentId } = req.params;

    const updatedEnrollment = await req.Enrollment.findByIdAndUpdate(
      enrollmentId,
      { className: newClassName },
      { new: true }
    );

    if (!updatedEnrollment) {
      return res.status(404).send('Enrollment record not found');
    }

    res.redirect('back');
  } catch (err) {
    res.status(500).send('Error changing classroom: ' + err.message);
  }
});

// ==========================================
// 👔 STAFF & TRAINER MANAGEMENT ROUTES (ADMIN ONLY)
// ==========================================

// 1. READ: Staff စာရင်း
app.get('/staffs', requireAuth, authorizeRoles('Admin'), tenantMiddleware, async (req, res) => {
  try {
    const StaffModel = getStaffModel(req);
    const staffs = await StaffModel.find().sort({ createdAt: -1 });

    res.render('staff-management', { 
      staffs, 
      user: req.session.user,
      error: null,
      success: null,
      activePage: 'staffs'
    });
  } catch (err) {
    res.status(500).send('Error loading staff page: ' + err.message);
  }
});

// 2. CREATE: Staff အကောင့်သစ်
app.post('/staffs/create', requireAuth, authorizeRoles('Admin'), tenantMiddleware, async (req, res) => {
  try {
    const { name, email, phone, role, password } = req.body;
    const StaffModel = getStaffModel(req);

    const existing = await StaffModel.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      const staffs = await StaffModel.find().sort({ createdAt: -1 });
      return res.render('staff-management', { 
        staffs, 
        user: req.session.user, 
        error: 'ဒီ Email ဖြင့် အကောင့်ရှိပြီးသားဖြစ်ပါသည်။',
        success: null,
        activePage: 'staffs'
      });
    }

    await StaffModel.create({
      name,
      email: email.trim().toLowerCase(),
      phone,
      role,
      password
    });

    res.redirect('/staffs');
  } catch (err) {
    res.status(500).send('Error creating staff: ' + err.message);
  }
});

// 3. UPDATE: Staff အချက်အလက်ပြင်ခြင်း
app.post('/staffs/edit/:id', requireAuth, authorizeRoles('Admin'), tenantMiddleware, async (req, res) => {
  try {
    const { name, email, phone, role, password, status } = req.body;
    const StaffModel = getStaffModel(req);

    const updateData = { name, email: email.trim().toLowerCase(), phone, role, status };
    if (password && password.trim() !== '') {
      updateData.password = password;
    }

    await StaffModel.findByIdAndUpdate(req.params.id, updateData);
    res.redirect('/staffs');
  } catch (err) {
    res.status(500).send('Error updating staff: ' + err.message);
  }
});

// 4. DELETE: Staff ဖျက်ခြင်း
app.post('/staffs/delete/:id', requireAuth, authorizeRoles('Admin'), tenantMiddleware, async (req, res) => {
  try {
    const StaffModel = getStaffModel(req);
    await StaffModel.findByIdAndDelete(req.params.id);
    res.redirect('/staffs');
  } catch (err) {
    res.status(500).send('Error deleting staff: ' + err.message);
  }
});

// ==========================================
// 🎓 STUDENT & ENROLLMENT ACTION ROUTES
// ==========================================

app.get('/api/student-history/:studentId', requireAuth, tenantMiddleware, async (req, res) => {
  try {
    const student = await req.Student.findOne({ studentId: req.params.studentId });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const courses = await req.Enrollment.find({ student: student._id }).sort({ createdAt: -1 });
    res.json({ student, courses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/register-new', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
  try {
    const {
      name, fatherName, phone, emergencyPhone, gender, age, nrc, email, address,
      course, className, startDate, courseFee, initialPaid, paymentMethod
    } = req.body;

    const targetClass = await req.Classroom.findOne({ className });
    if (targetClass) {
      const currentCount = await req.Enrollment.countDocuments({ className });
      if (currentCount >= targetClass.studentLimit) {
        return res.status(400).send(`Error: ${className} တွင် ကျောင်းသားဦးရေ ပြည့်နေပါပြီ။ (Max: ${targetClass.studentLimit})`);
      }
    }

    const studentId = await generateStudentId(req.Student);
    const newStudent = new req.Student({
      studentId, name, fatherName, phone, emergencyPhone, gender, age: parseInt(age) || 0, nrc, email, address
    });
    const savedStudent = await newStudent.save();

    const fee = parseFloat(courseFee) || 0;
    const paid = parseFloat(initialPaid) || 0;
    const remaining = Math.max(0, fee - paid);
    let status = paid >= fee ? 'Paid' : (paid > 0 ? 'Credit' : 'Unpaid');

    const newEnrollment = new req.Enrollment({
      student: savedStudent._id,
      course, 
      className, 
      startDate: startDate ? new Date(startDate) : new Date(),
      courseFee: fee, 
      initialPaid: paid, 
      remainingBalance: remaining,
      paymentMethod, 
      paymentStatus: status
    });
    await newEnrollment.save();

    if (paid > 0) {
      await req.Payment.create({
        student: savedStudent._id,
        enrollment: newEnrollment._id,
        amount: paid,
        paymentType: 'Initial',
        paymentMethod: paymentMethod || 'Cash'
      });
    }

    res.redirect('/');
  } catch (err) {
    res.status(400).send('Error registering student: ' + err.message);
  }
});

app.get('/api/student/:id', requireAuth, tenantMiddleware, async (req, res) => {
  try {
    const student = await req.Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/edit-student/:id', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
  try {
    const { name, fatherName, phone, emergencyPhone, gender, age, nrc, email, address } = req.body;

    await req.Student.findByIdAndUpdate(req.params.id, {
      name, fatherName, phone, emergencyPhone, gender, age: parseInt(age) || 0, nrc, email, address
    });

    res.redirect('back');
  } catch (err) {
    res.status(500).send('Error updating student: ' + err.message);
  }
});

app.post('/add-course', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
  try {
    const { studentObjId, course, className, startDate, courseFee, initialPaid, paymentMethod } = req.body;

    const targetClass = await req.Classroom.findOne({ className });
    if (targetClass) {
      const currentCount = await req.Enrollment.countDocuments({ className });
      if (currentCount >= targetClass.studentLimit) {
        return res.status(400).send(`Error: ${className} တွင် ကျောင်းသားဦးရေ ပြည့်နေပါပြီ။ (Max: ${targetClass.studentLimit})`);
      }
    }

    const fee = parseFloat(courseFee) || 0;
    const paid = parseFloat(initialPaid) || 0;
    const remaining = Math.max(0, fee - paid);
    let status = paid >= fee ? 'Paid' : (paid > 0 ? 'Credit' : 'Unpaid');

    const newEnrollment = new req.Enrollment({
      student: studentObjId,
      course, 
      className, 
      startDate: startDate ? new Date(startDate) : new Date(),
      courseFee: fee, 
      initialPaid: paid, 
      remainingBalance: remaining,
      paymentMethod, 
      paymentStatus: status
    });
    await newEnrollment.save();

    if (paid > 0) {
      await req.Payment.create({
        student: studentObjId,
        enrollment: newEnrollment._id,
        amount: paid,
        paymentType: 'Initial',
        paymentMethod: paymentMethod || 'Cash'
      });
    }

    res.redirect('/');
  } catch (err) {
    res.status(400).send('Error adding course: ' + err.message);
  }
});

app.post('/pay-balance/:enrollmentId', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
  try {
    const { paymentAmount, paymentMethod } = req.body;
    const payAmt = parseFloat(paymentAmount) || 0;

    const enrollment = await req.Enrollment.findById(req.params.enrollmentId);
    if (!enrollment) return res.status(404).send('Enrollment not found');

    const newPaid = enrollment.initialPaid + payAmt;
    const newRemaining = Math.max(0, enrollment.remainingBalance - payAmt);
    let newStatus = newRemaining === 0 ? 'Paid' : 'Credit';

    enrollment.initialPaid = newPaid;
    enrollment.remainingBalance = newRemaining;
    enrollment.paymentStatus = newStatus;
    enrollment.paymentMethod = paymentMethod;

    await enrollment.save();

    if (payAmt > 0) {
      await req.Payment.create({
        student: enrollment.student,
        enrollment: enrollment._id,
        amount: payAmt,
        paymentType: 'Debt Payment',
        paymentMethod: paymentMethod || 'Cash'
      });
    }

    res.redirect('/');
  } catch (err) {
    res.status(500).send('Error collecting payment: ' + err.message);
  }
});

app.post('/api/pay-balance', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
  try {
    const { enrollmentId, paymentAmount, paymentMethod } = req.body;
    const payAmt = parseFloat(paymentAmount) || 0;

    const enrollment = await req.Enrollment.findById(enrollmentId);
    if (!enrollment) return res.status(404).json({ error: 'Enrollment record not found' });

    const newPaid = enrollment.initialPaid + payAmt;
    const newRemaining = Math.max(0, enrollment.remainingBalance - payAmt);
    let newStatus = newRemaining === 0 ? 'Paid' : 'Credit';

    enrollment.initialPaid = newPaid;
    enrollment.remainingBalance = newRemaining;
    enrollment.paymentStatus = newStatus;
    enrollment.paymentMethod = paymentMethod;

    await enrollment.save();

    if (payAmt > 0) {
      await req.Payment.create({
        student: enrollment.student,
        enrollment: enrollment._id,
        amount: payAmt,
        paymentType: 'Debt Payment',
        paymentMethod: paymentMethod || 'Cash'
      });
    }

    res.json({ success: true, message: 'Payment updated successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/delete-enrollment/:id', requireAuth, restrictStudentAccess, tenantMiddleware, async (req, res) => {
  try {
    await req.Enrollment.findByIdAndDelete(req.params.id);
    res.redirect('/');
  } catch (err) {
    res.status(500).send('Error deleting enrollment: ' + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));