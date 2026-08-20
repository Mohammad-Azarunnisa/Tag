import { JOB_TITLES } from '../config/constants.js';

/**
 * Check a submitted job title against the canonical list.
 *
 * Why this is not simply an enum on the model: the titles already in the
 * database were typed by hand and predate the list ("Co-Ordinator", "Coordinator
 * for NCET", one person's own first name). A Mongoose enum validates on every
 * save, so one of those people could not change their phone number without first
 * fixing a field they were not editing. Here the rule can be exactly what it
 * should be — a title has to be canonical *to be chosen*, but a title already
 * held may stay until its owner picks a real one.
 *
 * `current` is what the record holds now, which is what makes the second half of
 * that rule possible. The dropdowns offer the stored value as an extra option
 * marked "(current)", so opening a form and saving something else never silently
 * erases a legacy title.
 *
 * Returns { value } on success, { error } on refusal. The status code goes on
 * the response in the controller (middleware/error.js reads it there), so this
 * stays a plain function.
 */
export function resolveJobTitle(raw, current = '') {
  if (raw === undefined) return { value: undefined }; // not being changed

  const value = String(raw).trim();
  if (!value) return { value: '' }; // clearing it is always allowed

  if (JOB_TITLES.includes(value)) return { value };

  // Unchanged legacy title: let it through rather than blocking an unrelated edit.
  if (current && value === String(current).trim()) return { value };

  return {
    error: `"${value}" is not one of the job titles on the list. Pick one of: ${JOB_TITLES.join(', ')}`,
  };
}
