const mongoose = require('mongoose');
const { z } = require('zod');

const SAFE_FIELDS = '_id email name surname role language';

const lookupByEmail = {
  name: 'salesperson.lookup_by_email',
  description:
    'Reverse-lookup a salesperson by exact email address. Returns {found:true, salesperson:{_id, email, name, surname, role, language}} or {found:false, message}. Disabled or removed admins surface as found:false. Used by channel adapters to resolve sender→admin._id before setting X-Acting-As.',
  inputSchema: {
    email: z
      .string()
      .min(1)
      .email()
      .describe('Salesperson email — exact match, case-insensitive, trimmed'),
  },
  handler: async ({ email }) => {
    const normalized = email.toLowerCase().trim();
    const doc = await mongoose
      .model('Admin')
      .findOne({ email: normalized, removed: false })
      .select(`${SAFE_FIELDS} enabled`)
      .lean()
      .exec();

    if (!doc || doc.enabled === false) {
      return {
        ok: true,
        data: {
          found: false,
          message: `No matching salesperson (email=${normalized})`,
        },
      };
    }

    delete doc.enabled;
    return { ok: true, data: { found: true, salesperson: doc } };
  },
};

module.exports = { tools: [lookupByEmail] };
