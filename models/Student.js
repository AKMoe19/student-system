const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  studentId: { type: String, required: true },
  name: { type: String, required: true },
  fatherName: String,
  phone: String,
  emergencyPhone: String,
  gender: String,
  age: Number,
  nrc: String,
  email: { type: String, required: true, lowercase: true, trim: true },
  password: { type: String, default: null },
  address: String
}, { 
  timestamps: true // 👈 ဒီတစ်ကြောင်း ထည့်လိုက်ရင် createdAt နဲ့ updatedAt နှစ်ခုလုံး Auto ပါသွားပါပြီ
});

module.exports = studentSchema;