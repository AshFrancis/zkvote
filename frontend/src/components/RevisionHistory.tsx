import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, Clock, Loader2 } from "lucide-react";
import { Button } from "./ui/Button";
import {
  type CommentWithContent,
  type CommentMetadata,
  fetchCommentContent,
  formatRelativeTime,
} from "../lib/comments";

interface RevisionHistoryProps {
  comment: CommentWithContent;
  onClose: () => void;
}

interface RevisionEntry {
  cid: string;
  content: CommentMetadata | null;
  isLoading: boolean;
  isCurrent: boolean;
}

export default function RevisionHistory({
  comment,
  onClose,
}: RevisionHistoryProps) {
  const [revisions, setRevisions] = useState<RevisionEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    // Build list of revisions (oldest first, current last)
    const allCids = [...comment.revisionCids, comment.contentCid];
    const initialRevisions: RevisionEntry[] = allCids.map((cid, index) => ({
      cid,
      content: index === allCids.length - 1 ? comment.content : null,
      isLoading: index !== allCids.length - 1,
      isCurrent: index === allCids.length - 1,
    }));

    setRevisions(initialRevisions);
    setSelectedIndex(initialRevisions.length - 1);

    // Fetch content for historical revisions
    const fetchRevisions = async () => {
      const updatedRevisions = [...initialRevisions];

      for (let i = 0; i < comment.revisionCids.length; i++) {
        const cid = comment.revisionCids[i];
        try {
          const content = await fetchCommentContent(cid);
          updatedRevisions[i] = {
            ...updatedRevisions[i],
            content,
            isLoading: false,
          };
          setRevisions([...updatedRevisions]);
        } catch (err) {
          console.error(`Failed to fetch revision ${cid}:`, err);
          updatedRevisions[i] = {
            ...updatedRevisions[i],
            isLoading: false,
          };
          setRevisions([...updatedRevisions]);
        }
      }
    };

    if (comment.revisionCids.length > 0) {
      fetchRevisions();
    }
  }, [comment]);

  const selectedRevision = revisions[selectedIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-background border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold">Revision History</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Revision list */}
          <div className="w-48 border-r border-border overflow-y-auto">
            {revisions.map((revision, index) => (
              <button
                key={revision.cid}
                onClick={() => setSelectedIndex(index)}
                className={`w-full px-4 py-3 text-left border-b border-border hover:bg-muted/50 transition-colors ${
                  selectedIndex === index ? "bg-muted" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {revision.isCurrent ? "Current" : `v${index + 1}`}
                  </span>
                </div>
                {revision.content?.createdAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(revision.content.createdAt).toLocaleString()}
                  </p>
                )}
              </button>
            ))}
          </div>

          {/* Selected revision content */}
          <div className="flex-1 overflow-y-auto p-4">
            {selectedRevision?.isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : selectedRevision?.content ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  {selectedRevision.isCurrent ? (
                    <span>Current version</span>
                  ) : (
                    <span>
                      Edited{" "}
                      {formatRelativeTime(
                        Math.floor(
                          new Date(selectedRevision.content.createdAt).getTime() / 1000
                        )
                      )}
                    </span>
                  )}
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selectedRevision.content.body}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Failed to load revision content
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-muted/30">
          <p className="text-xs text-muted-foreground">
            {revisions.length} revision{revisions.length !== 1 ? "s" : ""} -{" "}
            Comment #{comment.id}
          </p>
        </div>
      </div>
    </div>
  );
}
