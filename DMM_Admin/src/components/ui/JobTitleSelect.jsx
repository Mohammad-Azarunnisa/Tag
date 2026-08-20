import { Select } from './primitives.jsx';
import { JOB_TITLES } from '../../lib/utils.js';

/**
 * Job title as a fixed choice rather than a text box.
 *
 * Typed titles gave the directory three spellings of the same job
 * ("Co-Ordinator", "Coordinator for NCET", "Torii Coordinator") and one person's
 * own first name, and every screen that groups or searches by title read those as
 * different jobs. The list is canonical and lives in one place — lib/utils.js,
 * mirroring DMM_backend/src/config/constants.js#JOB_TITLES, which is what the
 * server validates against.
 *
 * `current` is the value already stored on the record. If it is not on the list —
 * which is true of everyone whose title predates it — it is offered as an extra
 * option marked "(current)" so that opening a form and saving does not silently
 * erase what they had. The server allows an unchanged legacy title through for
 * the same reason.
 */
export default function JobTitleSelect({
  value,
  onChange,
  current = '',
  label = 'Job title',
  ...props
}) {
  const legacy = current && !JOB_TITLES.includes(current) ? current : '';

  return (
    <Select label={label} value={value || ''} onChange={onChange} {...props}>
      <option value="">— select a job title —</option>
      {legacy && <option value={legacy}>{legacy} (current)</option>}
      {JOB_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
    </Select>
  );
}
