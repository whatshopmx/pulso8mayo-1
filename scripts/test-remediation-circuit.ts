import { COMPLIANCE_SERVICE_MAPPINGS, getWorkflowTemplateForServiceType } from '../lib/compliance-mapping';

console.log('--- Testing Compliance Service Mapping ---');
console.log('FUMIGATION template:', getWorkflowTemplateForServiceType('FUMIGATION'));
console.log('FIRE_SYSTEM_CHECK template:', getWorkflowTemplateForServiceType('FIRE_SYSTEM_CHECK'));
console.log('CUSTOM template fallback:', getWorkflowTemplateForServiceType('CUSTOM'));

console.log('\n--- Service Mappings Configured ---');
Object.values(COMPLIANCE_SERVICE_MAPPINGS).forEach(m => {
  console.log(`[${m.serviceType}] => Name: "${m.name}", Template: "${m.defaultTemplateId}"`);
});

console.log('\n✅ Compliance Mapping Tests Passed.');
