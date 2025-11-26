import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

const token = 'testtoken';
const TEST_SECRET = 'SCVZXEUXJLRZKPCUXGXN53BJTD3RAZPRSSXHXDGSZQH5EOGEUTWINUXF';

const setupApp = async () => {
  process.env.RELAYER_SECRET_KEY = TEST_SECRET;
  process.env.VOTING_CONTRACT_ID = 'C'.padEnd(56, 'A');
  process.env.TREE_CONTRACT_ID = 'C'.padEnd(56, 'B');
  process.env.SOROBAN_RPC_URL = 'http://localhost';
  process.env.NETWORK_PASSPHRASE = 'Test';
  process.env.RELAYER_AUTH_TOKEN = token;
  process.env.HEALTH_EXPOSE_DETAILS = 'true';
  process.env.RELAYER_TEST_MODE = 'true';

  const relayer = await import('../src/relayer.js');
  return relayer.app || relayer.default || relayer;
};

test('health hides details without auth when token set', async () => {
  const app = await setupApp();
  const res = await request(app).get('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.relayer, undefined);
});

test('health shows details with auth', async () => {
  const app = await setupApp();
  const res = await request(app).get('/health').set('Authorization', `Bearer ${token}`);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.relayer);
  assert.ok(res.body.votingContract);
});

test('vote requires auth when token set', async () => {
  const app = await setupApp();
  const res = await request(app).post('/vote').send({});
  assert.equal(res.statusCode, 401);
});

test('config requires auth when token set', async () => {
  const app = await setupApp();
  const res = await request(app).get('/config');
  assert.equal(res.statusCode, 401);
});

test('config returns contract ids with auth', async () => {
  const app = await setupApp();
  const res = await request(app).get('/config').set('Authorization', `Bearer ${token}`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.votingContract.startsWith('C'), true);
  assert.equal(res.body.treeContract.startsWith('C'), true);
  assert.equal(typeof res.body.networkPassphrase, 'string');
  assert.equal(res.body.vkVersion, undefined);
});
