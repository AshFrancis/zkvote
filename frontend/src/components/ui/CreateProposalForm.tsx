import { useState } from "react";
import VoteModeSelector from "./VoteModeSelector";
import DeadlineInput from "./DeadlineInput";
import LoadingSpinner from "./LoadingSpinner";

interface CreateProposalFormProps {
  onSubmit: (data: {
    description: string;
    voteMode: "fixed" | "trailing";
    deadlineSeconds: number;
  }) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
  submittingLabel?: string;
}

export default function CreateProposalForm({
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel = "Create Proposal",
  submittingLabel = "Creating...",
}: CreateProposalFormProps) {
  const [description, setDescription] = useState("");
  const [voteMode, setVoteMode] = useState<"fixed" | "trailing">("trailing");
  const [deadlineSeconds, setDeadlineSeconds] = useState<string>(String(7 * 24 * 60 * 60)); // Default: 7 days

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    await onSubmit({
      description: description.trim(),
      voteMode,
      deadlineSeconds: parseInt(deadlineSeconds, 10) || 0,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Proposal Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe your proposal..."
          rows={3}
          disabled={isSubmitting}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50"
        />
      </div>

      <VoteModeSelector
        value={voteMode}
        onChange={setVoteMode}
        disabled={isSubmitting}
      />

      <DeadlineInput
        value={deadlineSeconds}
        onChange={setDeadlineSeconds}
        disabled={isSubmitting}
      />

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={isSubmitting || !description.trim()}
          className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isSubmitting && <LoadingSpinner size="sm" color="white" />}
          {isSubmitting ? submittingLabel : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
