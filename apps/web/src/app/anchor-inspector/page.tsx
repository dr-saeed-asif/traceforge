import { PageContainer, PageHeader } from "@/components/page-container";
import { ButtonLink } from "@/components/ui";
import { AnchorInspector } from "@/features/anchor-inspector/anchor-inspector";

export const metadata = { title: "Anchor inspector" };

export default async function AnchorInspectorPage({
  searchParams
}: {
  searchParams: Promise<{ promptId?: string; claimIndex?: string }>;
}) {
  const params = await searchParams;
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Blockchain audit"
        title="Anchor inspector"
        description="Decode transaction fields, recompute the claim fingerprints, and check the stored blockchain commitment."
        actions={
          <ButtonLink href="/sessions" variant="secondary">
            Back to sessions
          </ButtonLink>
        }
      />
      <AnchorInspector
        initialPromptId={typeof params.promptId === "string" ? params.promptId : ""}
        initialClaimIndex={typeof params.claimIndex === "string" ? params.claimIndex : "1"}
      />
    </PageContainer>
  );
}
