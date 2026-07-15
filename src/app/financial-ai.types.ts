export interface FinancialAiInsight {
  title: string;
  detail: string;
}

export interface FinancialAiAnalysis {
  headline: string;
  summary: string;
  insights: FinancialAiInsight[];
  risks: string[];
  recommendations: string[];
  generatedAt: string;
  period: string;
}
