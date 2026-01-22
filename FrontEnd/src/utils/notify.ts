import { message } from "antd";

/**
 * Display a success notification
 * @param msg - Success message to display
 */
export function notifySuccess(msg: string): void {
  message.success(msg);
}

/**
 * Display an error notification
 * @param msg - Error message to display
 */
export function notifyError(msg: string): void {
  message.error(msg);
}

/**
 * Display a warning notification
 * @param msg - Warning message to display
 */
export function notifyWarning(msg: string): void {
  message.warning(msg);
}

/**
 * Display an info notification
 * @param msg - Info message to display
 */
export function notifyInfo(msg: string): void {
  message.info(msg);
}
