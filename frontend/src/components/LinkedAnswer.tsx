import { memo } from "react";
import type { AnswerEvidenceLink } from "../types";

type LinkedAnswerProps = {
  answer: string;
  links: AnswerEvidenceLink[];
  activeLinkId: string | null;
  onHoverLink: (link: AnswerEvidenceLink | null) => void;
  onSelectLink: (link: AnswerEvidenceLink) => void;
  isStreaming: boolean;
};

function normalizeLinks(answer: string, links: AnswerEvidenceLink[]): AnswerEvidenceLink[] {
  return [...links]
    .filter(
      (link) =>
        link.start >= 0 &&
        link.end > link.start &&
        link.end <= answer.length &&
        link.text.length > 0,
    )
    .sort((left, right) => left.start - right.start);
}

export const LinkedAnswer = memo(function LinkedAnswer({
  answer,
  links,
  activeLinkId,
  onHoverLink,
  onSelectLink,
  isStreaming,
}: LinkedAnswerProps) {
  const normalizedLinks = normalizeLinks(answer, links);

  if (!answer) {
    return (
      <div className="answer-body">
        {isStreaming ? <span className="streaming-placeholder">正在整理回答...</span> : "-"}
      </div>
    );
  }

  const fragments: JSX.Element[] = [];
  let cursor = 0;

  normalizedLinks.forEach((link) => {
    if (link.start < cursor) {
      return;
    }

    if (link.start > cursor) {
      fragments.push(
        <span key={`text-${cursor}-${link.start}`}>{answer.slice(cursor, link.start)}</span>,
      );
    }

    const isActive = activeLinkId === link.id;
    fragments.push(
      <button
        key={link.id}
        className={`answer-link ${isActive ? "answer-link-active" : ""}`}
        type="button"
        onMouseEnter={() => onHoverLink(link)}
        onMouseLeave={() => onHoverLink(null)}
        onFocus={() => onHoverLink(link)}
        onBlur={() => onHoverLink(null)}
        onClick={() => onSelectLink(link)}
      >
        {answer.slice(link.start, link.end)}
      </button>,
    );

    cursor = link.end;
  });

  if (cursor < answer.length) {
    fragments.push(<span key={`text-${cursor}-end`}>{answer.slice(cursor)}</span>);
  }

  return (
    <div className="answer-body">
      {fragments}
      {isStreaming && <span className="answer-stream-cursor" aria-hidden="true" />}
    </div>
  );
});
