import PageHeader from '../components/layout/PageHeader.jsx';
import OrgPicker from '../components/OrgPicker.jsx';
import CalendarBoard from '../components/CalendarBoard.jsx';

export default function Calendar() {
  return (
    <div>
      <PageHeader title="Posting Calendar" subtitle="See how much content each organization published, by day." />
      <OrgPicker>
        {(orgId) => <CalendarBoard orgId={orgId} />}
      </OrgPicker>
    </div>
  );
}
