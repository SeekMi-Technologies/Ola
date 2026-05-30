/**
 * Tests for the trackActivity middleware (Ola CRM #220 D5 — kept after
 * decoupling in #221, since CRM is the only process in the auth path
 * that can populate Admin.lastActivity).
 *
 * Three guarantees worth covering:
 *   1. First request for an admin → Admin.findByIdAndUpdate called
 *   2. Second request within 60s for the same admin → DB call suppressed
 *      by the in-memory throttle Map
 *   3. Request without `req.admin` → next() called immediately, no DB
 *      call attempted
 *
 * Pattern mirrors the rest of backend/test/: require module-alias via
 * jest moduleNameMapper, autoload models for `mongoose.model('Admin')`
 * to resolve, run against mongodb-memory-server.
 */

const path = require('path');
const { globSync } = require('glob');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..');

let mongo;
let trackActivity;
let Admin;

function stubRes() {
  return {};
}

beforeAll(async () => {
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  trackActivity = require(path.join(BACKEND_ROOT, 'src/middlewares/trackActivity'));
  Admin = mongoose.model('Admin');
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await Admin.deleteMany({});
  trackActivity._resetThrottle();
});

describe('trackActivity middleware', () => {
  test('first request for an admin writes Admin.lastActivity', async () => {
    const admin = await Admin.create({
      email: 'fresh@x.com', name: 'Fresh', enabled: true, removed: false,
    });
    const next = jest.fn();
    const before = await Admin.findById(admin._id);
    expect(before.lastActivity).toBeNull();

    trackActivity({ admin: { _id: admin._id } }, stubRes(), next);
    expect(next).toHaveBeenCalledTimes(1);

    // findByIdAndUpdate is fire-and-forget — give it a tick to flush.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));

    const after = await Admin.findById(admin._id);
    expect(after.lastActivity).toBeInstanceOf(Date);
  });

  test('second request within the 60s window suppresses the DB write', async () => {
    const admin = await Admin.create({
      email: 'busy@x.com', name: 'Busy', enabled: true, removed: false,
    });
    // Spy on the underlying call so the assertion is direct: was the
    // mongoose write issued or not? Without this, an emulated DB delay
    // could mask a missing throttle.
    const updateSpy = jest.spyOn(Admin, 'findByIdAndUpdate');

    trackActivity({ admin: { _id: admin._id } }, stubRes(), jest.fn());
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // 9 more requests immediately — all should be throttled.
    for (let i = 0; i < 9; i++) {
      trackActivity({ admin: { _id: admin._id } }, stubRes(), jest.fn());
    }
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // After resetting the throttle Map, the next request should write again.
    trackActivity._resetThrottle();
    trackActivity({ admin: { _id: admin._id } }, stubRes(), jest.fn());
    expect(updateSpy).toHaveBeenCalledTimes(2);

    updateSpy.mockRestore();
  });

  test('request with no req.admin calls next() and never touches Mongo', () => {
    const updateSpy = jest.spyOn(Admin, 'findByIdAndUpdate');
    const next = jest.fn();
    trackActivity({}, stubRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();

    // req.admin without _id is also a no-op.
    next.mockClear();
    trackActivity({ admin: {} }, stubRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();

    updateSpy.mockRestore();
  });
});
