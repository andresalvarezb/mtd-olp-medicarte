import { notFound } from 'next/navigation';
import { PatientMasterDemoView } from '@/features/patients/patient-master-demo-view';
import { PATIENT_MASTER_DEMO_FIXTURES } from '@/features/patients/patient-master-demo-model';

export default function PatientMasterDemoPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <PatientMasterDemoView records={PATIENT_MASTER_DEMO_FIXTURES} />;
}
