import { Toaster } from 'sonner';

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      expand
      richColors
      closeButton
      duration={4000}
      theme="dark"
    />
  );
}
