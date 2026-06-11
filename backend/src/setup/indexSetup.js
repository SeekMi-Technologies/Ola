// 设置索引的函数
const setupIndexes = async () => {
  try {
    console.log('开始设置数据库索引...');
    
    // Require models directly so this module is self-contained — callers
    // (setup.js) don't pre-register appModels, and mongoose.model() throws
    // MissingSchemaError on unregistered names.
    const Invoice = require('../models/appModels/Invoice');
    const Client = require('../models/appModels/Client');
    const PurchaseOrder = require('../models/appModels/PurchaseOrder');
    const Admin = require('../models/coreModels/Admin');
    const AdminPassword = require('../models/coreModels/AdminPassword');

    // Admin 登录热路径：login 按 email 查、每次 /api 请求 isValidAuthToken
    // 按 _id/user 查。之前缺索引，所有认证请求都扫全表
    await Admin.collection.createIndex(
      { email: 1 },
      { name: 'admin_email_unique_idx', unique: true, background: true }
    );
    console.log('Admin.email 唯一索引创建成功');

    // AdminPassword.user 在 schema 里已 unique，mongoose 在 dev 会自动建 user_1
    // 这里显式 createIndex 用相同 name 保证幂等（避免 prod 禁 autoIndex 后漏建）
    await AdminPassword.collection.createIndex(
      { user: 1 },
      { name: 'user_1', unique: true, background: true }
    );
    console.log('AdminPassword.user 唯一索引创建成功');

    // 为Invoice创建复合索引
    await Invoice.collection.createIndex(
      { 
        client: 1,        // 客户ID
        date: -1,         // 日期降序排序
        removed: 1        // 是否已删除
      }, 
      { 
        name: 'invoice_client_date_idx',
        background: true  // 后台创建索引，不阻塞其他操作
      }
    );
    console.log('Invoice客户日期索引创建成功');
    
    // 为Invoice的items.itemName创建索引
    await Invoice.collection.createIndex(
      { 
        'items.itemName': 1,  // 商品名称
        removed: 1            // 是否已删除
      }, 
      { 
        name: 'invoice_items_idx',
        background: true
      }
    );
    console.log('Invoice商品名称索引创建成功');
    
    // 为Invoice创建复合索引（客户+商品+日期）
    await Invoice.collection.createIndex(
      { 
        client: 1,           // 客户ID
        'items.itemName': 1, // 商品名称
        date: -1,            // 日期降序排序
        removed: 1           // 是否已删除
      }, 
      { 
        name: 'invoice_client_item_date_idx',
        background: true
      }
    );
    console.log('Invoice客户商品日期复合索引创建成功');
    
    // 为Client创建国家索引
    await Client.collection.createIndex(
      { 
        country: 1,   // 国家
        removed: 1    // 是否已删除
      }, 
      { 
        name: 'client_country_idx',
        background: true
      }
    );
    console.log('Client国家索引创建成功');
    
    // 为PurchaseOrder创建商品索引
    await PurchaseOrder.collection.createIndex(
      { 
        'items.itemName': 1,  // 商品名称
        removed: 1            // 是否已删除
      }, 
      { 
        name: 'po_items_idx',
        background: true
      }
    );
    console.log('PurchaseOrder商品名称索引创建成功');
    
    // 为PurchaseOrder创建ID和商品名称的复合索引，用于优化关联查询
    await PurchaseOrder.collection.createIndex(
      { 
        _id: 1,              // PO ID
        'items.itemName': 1, // 商品名称
        removed: 1           // 是否已删除
      }, 
      { 
        name: 'po_id_items_idx',
        background: true
      }
    );
    console.log('PurchaseOrder ID和商品名称复合索引创建成功');
    
    // 为Invoice创建relatedPurchaseOrders索引，优化关联查询
    await Invoice.collection.createIndex(
      { 
        relatedPurchaseOrders: 1,  // 关联的采购订单
        removed: 1                 // 是否已删除
      }, 
      { 
        name: 'invoice_related_po_idx',
        background: true
      }
    );
    console.log('Invoice关联采购订单索引创建成功');
    
    console.log('所有索引设置完成！');
  } catch (error) {
    console.error('设置索引时出错:', error);
  }
};

module.exports = setupIndexes; 