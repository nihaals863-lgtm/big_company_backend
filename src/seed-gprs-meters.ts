import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const gprsMapping = [
  { imei: '865395070835176', meterNo: '2510170000034' },
  { imei: '865395070835077', meterNo: '2510170000042' },
  { imei: '865395070834815', meterNo: '2510170000059' },
  { imei: '865395070834799', meterNo: '2510170000067' },
  { imei: '865395070836075', meterNo: '2510170000075' },
  { imei: '865395070835358', meterNo: '2510170000083' },
  { imei: '865395070835564', meterNo: '2510170000091' },
  { imei: '865395070835598', meterNo: '2510170000109' },
  { imei: '865395070835234', meterNo: '2510170000117' },
  { imei: '865395070835143', meterNo: '2510170000125' },
  { imei: '865395070835200', meterNo: '2510170000133' },
  { imei: '865395070835267', meterNo: '2510170000141' },
  { imei: '865395070836364', meterNo: '2510170000158' },
  { imei: '865395070832993', meterNo: '2510170000166' },
  { imei: '865395070830052', meterNo: '2510170000174' },
  { imei: '865395070836042', meterNo: '2510170000182' },
];

async function main() {
  console.log('🚀 Starting GPRS Meter Mapping Import...');

  // Use consumer ID 1 as the default owner for these GPRS meters
  const defaultConsumerId = 1;

  for (const item of gprsMapping) {
    try {
      const result = await prisma.gasMeter.upsert({
        where: { meterNumber: item.meterNo },
        update: {
          imei: item.imei,
          isGprs: true,
          meterType: 'TOKEN', // These are STS tokens pushed via GPRS
        },
        create: {
          meterNumber: item.meterNo,
          imei: item.imei,
          isGprs: true,
          meterType: 'TOKEN',
          consumerId: defaultConsumerId,
          status: 'active'
        },
      });
      console.log(`✅ Linked Meter: ${item.meterNo} -> IMEI: ${item.imei}`);
    } catch (error: any) {
      console.error(`❌ Failed to link Meter: ${item.meterNo}. Error: ${error.message}`);
    }
  }

  console.log('✨ Import completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
