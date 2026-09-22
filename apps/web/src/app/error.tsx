"use client";

import { PageContainer, PageHeader } from "@/components/page-container";
import { Button, ErrorState } from "@/components/ui";

export default function GlobalError({
  reset
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="Application error"
        title="The verification workspace hit a problem"
        description="The failure is isolated to this page. Your stored evidence has not been changed."
      />
      <ErrorState
        description="Try loading this view again. If the problem continues, check the TraceForge API connection."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </PageContainer>
  );
}
