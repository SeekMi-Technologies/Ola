require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '.env.local' });
const { globSync } = require('glob');
const fs = require('fs');
const { generate: uniqueId } = require('shortid');

const mongoose = require('mongoose');
mongoose.connect(process.env.DATABASE);

async function setupApp() {
  try {
    const Admin = require('../models/coreModels/Admin');
    const AdminPassword = require('../models/coreModels/AdminPassword');

    const newAdminPassword = new AdminPassword();

    const salt = uniqueId();

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      throw new Error('CRITICAL ERROR: Please define ADMIN_EMAIL and ADMIN_PASSWORD in your .env file before running setup.');
    }

    const passwordHash = newAdminPassword.generateHash(salt, adminPassword);

    const defaultAdmin = {
      email: adminEmail,
      name: 'Super',
      surname: 'Admin',
      enabled: true,
      role: 'owner',
    };
    const result = await new Admin(defaultAdmin).save();

    const AdminPasswordData = {
      password: passwordHash,
      emailVerified: true,
      salt: salt,
      user: result._id,
    };
    await new AdminPassword(AdminPasswordData).save();

    console.log(`👍 Admin created: ${adminEmail} : Done!`);

    const Setting = require('../models/coreModels/Setting');

    const settingFiles = [];

    const settingsFiles = globSync('./src/setup/defaultSettings/**/*.json');

    for (const filePath of settingsFiles) {
      const file = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      for (const setting of file) {
        settingFiles.push({ ...setting, createdBy: result._id });
      }
    }

    await Setting.insertMany(settingFiles);

    console.log('👍 Settings created : Done!');

    const PaymentMode = require('../models/appModels/PaymentMode');
    const Taxes = require('../models/appModels/Taxes');

    await Taxes.insertMany([{ taxName: 'Tax 0%', taxValue: '0', isDefault: true, createdBy: result._id }]);
    console.log('👍 Taxes created : Done!');

    await PaymentMode.insertMany([
      {
        name: 'Default Payment',
        description: 'Default Payment Mode (Cash , Wire Transfert)',
        isDefault: true,
        createdBy: result._id,
      },
    ]);
    console.log('👍 PaymentMode created : Done!');
    const setupIndexes = require('./indexSetup');
    try {
      await setupIndexes();
    } catch (error) {
      console.error('设置索引时出错:', error);
    }

    console.log('🥳 Setup completed :Success!');
    process.exit();
  } catch (e) {
    console.log('\n🚫 Error! The Error info is below');
    console.log(e);
    process.exit(1);
  }
}

setupApp();
