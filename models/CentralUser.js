const mongoose = require('mongoose');

const mainDb = mongoose.createConnection(process.env.CENTRAL_MONGODB_URI || 'mongodb://127.0.0.1:27017/main_db');

const centralUserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true }, // Username အစား Email ပြောင်းလဲလိုက်ပါသည်
  username: { type: String }, // optional display name
  password: { type: String, required: true },
  role: { 
    type: String, 
    enum: ['Admin', 'Office Staff', 'Trainer', 'Student'], 
    default: 'Student' 
  },
  tenantId: { type: String, required: true }, // ဥပမာ - tenant_admin1
  createdAt: { type: Date, default: Date.now }
});

module.exports = mainDb.model('CentralUser', centralUserSchema);