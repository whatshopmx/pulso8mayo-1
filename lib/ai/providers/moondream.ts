
export interface BBox {
    x_min: number;
    y_min: number;
    x_max: number;
    y_max: number;
}

export interface AIProviderConfig {
    apiKey: string;
    model?: string;
    maxTokens?: number;
}

export interface AIAnalysisResult {
    isCompliant: boolean;
    confidence: number;
    description: string;
    detectedValues?: Record<string, any>;
    rawResponse?: any;
}

export class MoondreamProvider {
    private apiKey: string;
    private baseUrl = 'https://api.moondream.ai/v1';
    private model = 'moondream3.1-9B-A2B';

    constructor(config: AIProviderConfig) {
        this.apiKey = config.apiKey;
        if (config.model) this.model = config.model;
    }

    private async fetchImageAsBase64(imageUrl: string): Promise<string> {
        if (!imageUrl.startsWith('http')) return imageUrl;

        console.log(`[Moondream] Fetching image for base64 conversion: ${imageUrl}`);
        const imageRes = await fetch(imageUrl);
        if (!imageRes.ok) throw new Error(`Failed to fetch image: ${imageRes.statusText}`);
        const arrayBuffer = await imageRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mimeType = imageRes.headers.get('content-type') || 'image/jpeg';
        return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }

    async query(imageUrl: string, question: string): Promise<{ answer: string; requestId: string; metrics?: Record<string, any> }> {
        const base64Image = await this.fetchImageAsBase64(imageUrl);

        const response = await fetch(`${this.baseUrl}/query`, {
            method: 'POST',
            headers: {
                'X-Moondream-Auth': this.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                image_url: base64Image,
                question,
                model: this.model,
                stream: false,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Moondream query API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        return {
            answer: data.answer || '',
            requestId: data.request_id || '',
            metrics: data.metrics,
        };
    }

    async caption(imageUrl: string, length?: 'short' | 'normal' | 'long'): Promise<{ caption: string; requestId: string; metrics?: Record<string, any> }> {
        const base64Image = await this.fetchImageAsBase64(imageUrl);

        const body: Record<string, any> = {
            image_url: base64Image,
            model: this.model,
        };
        if (length) body.length = length;

        const response = await fetch(`${this.baseUrl}/caption`, {
            method: 'POST',
            headers: {
                'X-Moondream-Auth': this.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Moondream caption API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        return {
            caption: data.caption || '',
            requestId: data.request_id || '',
            metrics: data.metrics,
        };
    }

    async detect(imageUrl: string, object: string): Promise<{ objects: BBox[]; count: number; requestId: string }> {
        const base64Image = await this.fetchImageAsBase64(imageUrl);

        const response = await fetch(`${this.baseUrl}/detect`, {
            method: 'POST',
            headers: {
                'X-Moondream-Auth': this.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                image_url: base64Image,
                object,
                model: this.model,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Moondream detect API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        return {
            objects: (data.objects || []).map((o: any) => ({
                x_min: o.x_min,
                y_min: o.y_min,
                x_max: o.x_max,
                y_max: o.y_max,
            })),
            count: data.objects?.length || 0,
            requestId: data.request_id || '',
        };
    }

    async point(imageUrl: string, object: string): Promise<{ points: { x: number; y: number }[]; count: number; requestId: string }> {
        const base64Image = await this.fetchImageAsBase64(imageUrl);

        const response = await fetch(`${this.baseUrl}/point`, {
            method: 'POST',
            headers: {
                'X-Moondream-Auth': this.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                image_url: base64Image,
                object,
                model: this.model,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Moondream point API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        return {
            points: (data.points || []).map((p: any) => ({ x: p.x, y: p.y })),
            count: data.points?.length || 0,
            requestId: data.request_id || '',
        };
    }

    async segment(imageUrl: string, object: string): Promise<{ path: string; bbox: BBox; requestId: string }> {
        const base64Image = await this.fetchImageAsBase64(imageUrl);

        const response = await fetch(`${this.baseUrl}/segment`, {
            method: 'POST',
            headers: {
                'X-Moondream-Auth': this.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                image_url: base64Image,
                object,
                model: this.model,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Moondream segment API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        return {
            path: data.path || '',
            bbox: {
                x_min: data.x_min ?? 0,
                y_min: data.y_min ?? 0,
                x_max: data.x_max ?? 0,
                y_max: data.y_max ?? 0,
            },
            requestId: data.request_id || '',
        };
    }

    async analyzeImage(imageUrl: string, prompt: string): Promise<AIAnalysisResult> {
        try {
            const result = await this.query(imageUrl, prompt);
            const answer = result.answer;

            const isCompliant = !answer.toLowerCase().includes('no') &&
                !answer.toLowerCase().includes('dirty') &&
                !answer.toLowerCase().includes('fail');

            const confidence = result.metrics?.confidence ?? 0.85;

            return {
                isCompliant,
                confidence,
                description: answer,
                rawResponse: result,
            };
        } catch (error) {
            console.error('Moondream analysis failed:', error);
            throw error;
        }
    }
}
