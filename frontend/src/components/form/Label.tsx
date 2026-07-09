

export default function Label({ children, className = '' }: { children: React.ReactNode, className?: string }) {
  return (
    <label className={`block mb-1.5 font-medium text-gray-700 text-sm dark:text-gray-300 ${className}`}>
      {children}
    </label>
  );
}
