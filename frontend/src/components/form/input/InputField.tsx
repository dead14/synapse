

export default function InputField(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent dark:bg-gray-900/50 dark:border-gray-700 dark:text-white dark:focus:ring-brand-400 ${props.className || ''}`}
    />
  );
}
