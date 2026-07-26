import type { InputHTMLAttributes } from 'react';

type SynInputProps = InputHTMLAttributes<HTMLInputElement> & {
  state?: 'default' | 'success' | 'error';
};

export default function SynInput({ state = 'default', className = '', ...props }: SynInputProps) {
  return <input {...props} className={`syn-input syn-input--${state}${className ? ` ${className}` : ''}`} />;
}
