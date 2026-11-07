import { Modal } from './Modal.jsx';
import { Button } from './Button.jsx';

// "Are you sure?" pop-up for deletes. Nothing is removed until Delete is pressed;
// Cancel, the X or a click outside simply closes it.
export default function ConfirmDelete({ open, loading, onConfirm, onCancel, message = 'Are you sure you want to delete this item?' }) {
  return (
    <Modal open={open} onClose={onCancel} title="Delete item" size="sm">
      <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" loading={loading} onClick={onConfirm}>Delete</Button>
      </div>
    </Modal>
  );
}
