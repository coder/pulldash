import { useGitHub } from "@/browser/contexts/github";
import { usePRReviewSelector } from ".";

export function useFileCopyActions() {
  const github = useGitHub();
  const owner = usePRReviewSelector((s) => s.owner);
  const repo = usePRReviewSelector((s) => s.repo);
  const pr = usePRReviewSelector((s) => s.pr);
  const files = usePRReviewSelector((s) => s.files);

  const copyDiff = (filename: string) => {
    const file = files.find((f) => f.filename === filename);
    if (file?.patch) {
      navigator.clipboard.writeText(file.patch);
    }
  };

  const copyFile = async (filename: string) => {
    try {
      const content = await github.getFileContent(
        owner,
        repo,
        filename,
        pr.head.sha
      );
      await navigator.clipboard.writeText(content);
    } catch (error) {
      console.error("Failed to copy file:", error);
    }
  };

  const copyMainVersion = async (filename: string) => {
    try {
      const file = files.find((f) => f.filename === filename);
      const basePath = file?.previous_filename || filename;
      const content = await github.getFileContent(
        owner,
        repo,
        basePath,
        pr.base.sha
      );
      await navigator.clipboard.writeText(content);
    } catch (error) {
      console.error("Failed to copy base version:", error);
    }
  };

  return { copyDiff, copyFile, copyMainVersion };
}
