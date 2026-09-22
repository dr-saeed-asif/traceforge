import { PageContainer, PageHeader } from "@/components/page-container";
import { ButtonLink, EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <PageContainer size="narrow">
      <PageHeader eyebrow="404" title="This verification view does not exist" />
      <EmptyState
        title="Page not found"
        description="The link may be outdated, or the requested verification session is no longer available."
        action={<ButtonLink href="/sessions">Return to sessions</ButtonLink>}
      />
    </PageContainer>
  );
}
