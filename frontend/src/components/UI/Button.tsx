import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
};
export function Button({
  children,
  loading,
  variant = 'secondary',
  className = '',
  disabled,
  ...props
}: Props) {
  return (
    <button
      type="button"
      className={`button button-${variant} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <LoaderCircle size={17} className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
