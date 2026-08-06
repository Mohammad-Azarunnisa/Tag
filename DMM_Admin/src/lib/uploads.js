// What the file pickers offer, kept in step with the backend's allow-list in
// middleware/upload.js. Extensions are listed alongside mime types because
// PSD / AI / Office files report inconsistent mime types across browsers.
export const UPLOAD_ACCEPT = [
  'image/*',
  'video/*',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv',
  '.ppt', '.pptx', '.psd', '.ai', '.eps', '.txt',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
].join(',');
