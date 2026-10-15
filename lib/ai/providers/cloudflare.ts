import OpenAI from 'openai';
import { AIAnalysisResult } from './moondream';

export interface CloudflareProviderConfig {
    apiToken: string;
    accountId: string;
    model?: string;
}

export class CloudflareWorkersAIProvider {
    private client: OpenAI;
    private model: string;

    constructor(config: CloudflareProviderConfig) {
        if (!config.apiToken) {
            throw new Error('CLOUDFLARE_API_TOKEN not configured');
        }
        if (!config.accountId) {
            throw new Error('CLOUDFLARE_ACCOUNT_ID not configured');
        }

        this.client = new OpenAI({
            apiKey: config.apiToken,
            baseURL: `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/v1`,
        });
        this.model = config.model || '@cf/meta/llama-3.2-11b-vision-instruct';
    }

    async analyzeImage(imageUrl: string, prompt: string): Promise<AIAnalysisResult> {
        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: imageUrl,
                                },
                            },
                        ],
                    },
                ],
                max_tokens: 350,
            });

            const content = response.choices?.[0]?.message?.content || '';

            const isCompliant =
                !content.toLowerCase().includes('non-compliant') &&
                !content.toLowerCase().includes('fail') &&
                !content.toLowerCase().includes('incumple');

            return {
                isCompliant,
                confidence: 0.90,
                description: content,
                rawResponse: response,
            };
        } catch (error) {
            console.error('[Cloudflare Workers AI] Analysis failed:', error);
            throw error;
        }
    }
}
