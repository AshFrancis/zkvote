import * as StellarSdk from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC_URL = 'https://rpc-futurenet.stellar.org:443';
const NETWORK_PASSPHRASE = 'Test SDF Future Network ; October 2022';
const COMMENTS_CONTRACT_ID = 'CC4CD66KN5QIATS5PSEYV4KRVA4HHYB5ZH3USOZK6AI6UMV4YCWZRSOT';
const ADMIN_SECRET = 'SAGSGX6EUVF2DYOAXEACSYIENMQ2ZLHEFP42Z65IYA5IYGXA3YJK23GT'; // Admin for DAO 1

// Load pre-formatted Soroban VK (same as used for voting contract)
const vkPath = path.join(__dirname, '../frontend/src/lib/verification_key_soroban.json');
const vk = JSON.parse(fs.readFileSync(vkPath, 'utf8'));

async function main() {
  try {
    console.log('Setting verification key for Comments Contract (DAO #1)...');
    console.log('Comments Contract:', COMMENTS_CONTRACT_ID);
    console.log('RPC URL:', RPC_URL);

    const server = new StellarSdk.rpc.Server(RPC_URL, { allowHttp: true });
    const sourceKeypair = StellarSdk.Keypair.fromSecret(ADMIN_SECRET);
    const account = await server.getAccount(sourceKeypair.publicKey());
    const contract = new StellarSdk.Contract(COMMENTS_CONTRACT_ID);

    // Convert hex strings to Buffers (already in correct format)
    const vkBuffers = {
      alpha: Buffer.from(vk.alpha, 'hex'),
      beta: Buffer.from(vk.beta, 'hex'),
      gamma: Buffer.from(vk.gamma, 'hex'),
      delta: Buffer.from(vk.delta, 'hex'),
      ic: vk.ic.map(ic => Buffer.from(ic, 'hex')),
    };

    console.log('Building transaction...');
    console.log('VK has', vk.ic.length, 'IC points');

    // Convert VerificationKey to proper Soroban struct format
    // The contract expects: set_vk(dao_id: u64, vk: VerificationKey, admin: Address)
    const vkStruct = StellarSdk.xdr.ScVal.scvMap([
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol('alpha'),
        val: StellarSdk.xdr.ScVal.scvBytes(vkBuffers.alpha),
      }),
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol('beta'),
        val: StellarSdk.xdr.ScVal.scvBytes(vkBuffers.beta),
      }),
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol('delta'),
        val: StellarSdk.xdr.ScVal.scvBytes(vkBuffers.delta),
      }),
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol('gamma'),
        val: StellarSdk.xdr.ScVal.scvBytes(vkBuffers.gamma),
      }),
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol('ic'),
        val: StellarSdk.xdr.ScVal.scvVec(
          vkBuffers.ic.map(buf => StellarSdk.xdr.ScVal.scvBytes(buf))
        ),
      }),
    ]);

    // Admin address for authorization
    const adminAddress = StellarSdk.Address.fromString(sourceKeypair.publicKey());

    // Build transaction with proper parameters:
    // set_vk(dao_id: u64, vk: VerificationKey, admin: Address)
    let transaction = new StellarSdk.TransactionBuilder(account, {
      fee: '10000000', // 10 XLM
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          'set_vk',
          StellarSdk.nativeToScVal(1, { type: 'u64' }), // dao_id
          vkStruct, // vk struct
          StellarSdk.xdr.ScVal.scvAddress(adminAddress.toScAddress()), // admin
        )
      )
      .setTimeout(30)
      .build();

    console.log('Simulating transaction...');

    // Simulate transaction
    const simulationResponse = await server.simulateTransaction(transaction);

    if (StellarSdk.rpc.Api.isSimulationError(simulationResponse)) {
      console.error('Simulation error:', simulationResponse.error);
      throw new Error(`Simulation failed: ${simulationResponse.error}`);
    }

    // Prepare transaction with simulation results
    transaction = StellarSdk.rpc.assembleTransaction(transaction, simulationResponse).build();

    // Sign transaction
    transaction.sign(sourceKeypair);

    console.log('Sending transaction...');

    // Send transaction
    const sendResponse = await server.sendTransaction(transaction);

    if (sendResponse.status === 'ERROR') {
      console.error('Transaction error:', sendResponse);
      throw new Error(`Transaction failed: ${JSON.stringify(sendResponse)}`);
    }

    console.log('Transaction sent! Hash:', sendResponse.hash);
    console.log('Waiting for confirmation...');

    // Poll for transaction result
    let getResponse = await server.getTransaction(sendResponse.hash);
    let attempts = 0;
    const maxAttempts = 30;

    while (getResponse.status === StellarSdk.rpc.Api.GetTransactionStatus.NOT_FOUND && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      getResponse = await server.getTransaction(sendResponse.hash);
      attempts++;
    }

    if (getResponse.status === StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS) {
      console.log('✅ Verification key set successfully for Comments Contract!');
      console.log('Anonymous comments should now work.');
    } else {
      console.error('Transaction status:', getResponse.status);
      if (getResponse.status === StellarSdk.rpc.Api.GetTransactionStatus.FAILED) {
        console.error('Transaction failed:', getResponse);
      }
      throw new Error('Transaction did not succeed');
    }
  } catch (error) {
    console.error('Error setting verification key:', error);
    process.exit(1);
  }
}

main();
