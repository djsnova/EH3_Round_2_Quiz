import { useState } from "react";

interface QuizQuestion {
  question: string;
  options: string[];
}

interface QuizCardProps {
  question: QuizQuestion;
  questionIndex: number;
  totalQuestions: number;
  onAnswer: (optionIndex: number) => void;
  disabled?: boolean;
  answered?: number | null;
  showResult?: boolean;
  correctOption?: number | null;
}

export function QuizCard({
  question,
  questionIndex,
  totalQuestions,
  onAnswer,
  disabled,
  answered,
  showResult,
  correctOption,
}: QuizCardProps) {
  const [hoveredOption, setHoveredOption] = useState<number | null>(null);

  const getOptionClass = (idx: number) => {
    const base =
      "w-full text-left px-5 py-4 rounded-lg border transition-all duration-200 font-medium text-sm";

    if (showResult && answered !== null && answered !== undefined && answered !== -1 && correctOption !== null && correctOption !== undefined) {
      if (idx === correctOption) {
        return `${base} border-success/50 bg-success/10 text-success glow-success`;
      }
      if (idx === answered && idx !== correctOption) {
        return `${base} border-destructive/50 bg-destructive/10 text-destructive glow-destructive`;
      }
      return `${base} border-border/30 bg-muted/20 text-muted-foreground opacity-50`;
    }

    // Timed out (answered === -1): just dim all options, don't reveal correct
    if (answered === -1) {
      return `${base} border-border/30 bg-muted/20 text-muted-foreground opacity-50`;
    }

    if (answered === idx) {
      return `${base} border-primary/60 bg-primary/15 text-primary glow-primary`;
    }

    return `${base} border-border/40 bg-muted/10 text-foreground hover:border-primary/40 hover:bg-primary/5 active:scale-[0.98]`;
  };

  const labels = ["A", "B", "C", "D"];

  return (
    <div className="glass-panel p-6 md:p-8 animate-scale-in w-full max-w-2xl mx-auto">
      {/* Question counter */}
      <div className="flex items-center justify-between mb-6">
        <span className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
          Question {questionIndex + 1} / {totalQuestions}
        </span>
        <div className="flex gap-1">
          {Array.from({ length: totalQuestions }, (_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                i === questionIndex
                  ? "bg-primary glow-primary"
                  : i < questionIndex
                  ? "bg-primary/40"
                  : "bg-muted-foreground/20"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Question */}
      <h2 className="text-xl md:text-2xl font-semibold mb-8 leading-relaxed" style={{ textWrap: "balance" as any }}>
        {question.question}
      </h2>

      {/* Options */}
      <div className="grid gap-3">
        {question.options.map((option, idx) => (
          <button
            key={idx}
            onClick={() => !disabled && onAnswer(idx)}
            disabled={disabled}
            onMouseEnter={() => setHoveredOption(idx)}
            onMouseLeave={() => setHoveredOption(null)}
            className={getOptionClass(idx)}
          >
            <span className="inline-flex items-center gap-3">
              <span
                className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0 transition-colors duration-200 ${
                  hoveredOption === idx && !disabled
                    ? "bg-primary/20 text-primary"
                    : "bg-muted/30 text-muted-foreground"
                }`}
              >
                {labels[idx]}
              </span>
              {option}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
