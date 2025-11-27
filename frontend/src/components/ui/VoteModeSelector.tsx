interface VoteModeSelectorProps {
  value: "fixed" | "trailing";
  onChange: (value: "fixed" | "trailing") => void;
  disabled?: boolean;
}

export default function VoteModeSelector({ value, onChange, disabled = false }: VoteModeSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Vote Mode
      </label>
      <div className="space-y-2">
        <label className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
          value === "fixed"
            ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
            : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
          <input
            type="radio"
            name="voteMode"
            value="fixed"
            checked={value === "fixed"}
            onChange={() => onChange("fixed")}
            disabled={disabled}
            className="mt-1 h-4 w-4 text-purple-600 focus:ring-purple-500"
          />
          <div>
            <span className="font-medium text-gray-900 dark:text-gray-100">Fixed (Snapshot)</span>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Only members who were present when the proposal was created can vote.
              Prevents vote manipulation through last-minute joins.
            </p>
          </div>
        </label>
        <label className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
          value === "trailing"
            ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
            : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
          <input
            type="radio"
            name="voteMode"
            value="trailing"
            checked={value === "trailing"}
            onChange={() => onChange("trailing")}
            disabled={disabled}
            className="mt-1 h-4 w-4 text-purple-600 focus:ring-purple-500"
          />
          <div>
            <span className="font-medium text-gray-900 dark:text-gray-100">Trailing (Dynamic)</span>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Members can vote even if they joined after the proposal was created.
              More inclusive but may allow vote manipulation.
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}
