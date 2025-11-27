import { useState } from "react";
import VoteModeSelector from "./VoteModeSelector";
import DeadlineInput from "./DeadlineInput";
import LoadingSpinner from "./LoadingSpinner";
import { Button } from "./Button";
import { Textarea } from "./Textarea";
import { Label } from "./Label";

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
      <div className="space-y-2">
        <Label>Proposal Description <span className="text-destructive">*</span></Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe your proposal..."
          rows={3}
          disabled={isSubmitting}
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
        <Button
          type="submit"
          variant="outline"
          disabled={isSubmitting || !description.trim()}
          className="flex-1"
        >
          {isSubmitting && <LoadingSpinner size="sm" className="mr-2" />}
          {isSubmitting ? submittingLabel : submitLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
