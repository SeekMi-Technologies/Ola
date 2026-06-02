require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '.env.local' });
const { generate: uniqueId } = require('shortid');
const mongoose = require('mongoose');
const { mongoConnectOptions } = require('../utils/dbOptions');

mongoose.connect(process.env.DATABASE, mongoConnectOptions());

async function addAdmin() {
  try {
    const Admin = require('../models/coreModels/Admin');
    const AdminPassword = require('../models/coreModels/AdminPassword');

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      console.error('CRITICAL ERROR: Please define ADMIN_EMAIL and ADMIN_PASSWORD in your .env file.');
      process.exit(1);
    }

    const existing = await Admin.findOne({ email: adminEmail, removed: { $ne: true } });
    if (existing) {
      console.log(`⚠️ ${adminEmail} 已存在，无需重复添加。`);
      process.exit(0);
      return;
    }

    const newAdminPassword = new AdminPassword();
    const salt = uniqueId();
    const passwordHash = newAdminPassword.generateHash(salt, adminPassword);

    const defaultAdmin = {
      email: adminEmail,
      name: 'Super',
      surname: 'Admin',
      enabled: true,
      role: 'owner',
    };
    const result = await new Admin(defaultAdmin).save();

    await new AdminPassword({
      password: passwordHash,
      emailVerified: true,
      salt,
      user: result._id,
    }).save();

    console.log(`👍 已安全添加系统管理员账户: ${adminEmail}`);
    process.exit(0);
  } catch (e) {
    console.error('添加失败:', e);
    process.exit(1);
  }
}

addAdmin();
