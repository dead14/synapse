

interface CheckboxProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

export default function Checkbox({ checked, onChange, className = '' }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className={`w-4 h-4 text-brand-500 border-gray-300 rounded focus:ring-brand-500 dark:focus:ring-brand-400 dark:ring-offset-gray-900 dark:bg-gray-800 dark:border-gray-600 cursor-pointer ${className}`}
    />
  );
}
