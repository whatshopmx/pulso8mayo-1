import 'dotenv/config';
import { getCashFlowProjection } from '@/lib/services/cash-flow-service';

async function main() {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await getCashFlowProjection('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 30, 'b1000001-0000-4000-8000-000000000001', { includeRecurringContracts: true });
      console.log('OK', JSON.stringify(r).slice(0, 200));
    } catch (e: any) {
      console.log('ERR', e.message?.slice(0, 120));
      let c = e.cause; while (c) { console.log('CAUSE', c.code, c.message, c.detail ?? '', c.where ?? ''); c = c.cause; }
    }
  }
  process.exit(0);
}
main();
