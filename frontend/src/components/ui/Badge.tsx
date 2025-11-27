interface BadgeProps {
  children: React.ReactNode;
  variant?: "purple" | "blue" | "green" | "red" | "amber" | "teal" | "gray";
  size?: "sm" | "md";
}

const variantStyles = {
  purple: "bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200",
  blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200",
  green: "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200",
  red: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200",
  amber: "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200",
  teal: "bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-200",
  gray: "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200",
};

const sizeStyles = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2 py-1 text-xs",
};

export default function Badge({ children, variant = "gray", size = "md" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded font-medium ${variantStyles[variant]} ${sizeStyles[size]}`}
    >
      {children}
    </span>
  );
}
