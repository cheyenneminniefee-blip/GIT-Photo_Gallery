from flask import Flask, request, jsonify, send_from_directory
import os
import requests
import base64

app = Flask(__name__, static_folder='.')

# Serve static files
@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')

# Endpoint for generating AI descriptions
@app.route('/api/generate-description', methods=['POST', 'OPTIONS'])
def generate_description():
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        return response, 200
    
    data = request.get_json()
    image_name = data.get('imageName', '') if data else ''
    image_url = data.get('imageUrl', '') if data else ''
    
    if not image_name:
        return jsonify({'error': 'No image name provided'}), 400
    
    api_key = os.environ.get('GROQ_API_KEY')
    if not api_key:
        return jsonify({'error': 'GROQ_API_KEY not configured in Replit Secrets'}), 400
    
    # Extract base name and create title
    base_name = image_name.replace('.jpg', '').replace('.jpeg', '').replace('.png', '')
    image_title = base_name.replace('_', ' ')
    
    # Use vision model if image URL is provided
    if image_url:
        # Try to fetch and encode the image as base64 to avoid 403 errors
        try:
            image_response = requests.get(image_url, timeout=10)
            if image_response.status_code == 200:
                # Encode image to base64
                image_data = base64.b64encode(image_response.content).decode('utf-8')
                image_mime = image_response.headers.get('Content-Type', 'image/jpeg')
                
                # Use Groq's vision-capable model with base64 encoded image
                vision_payload = {
                    'model': 'qwen/qwen3.6-27b',
                    'messages': [{
                        'role': 'user',
                        'content': [
                            {'type': 'text', 'text': f'Describe this image in a creative and detailed way. The image title is "{image_title}". Focus on what you can see in the image. Provide a 2-3 sentence description.'},
                            {'type': 'image_url', 'image_url': {'url': f'data:{image_mime};base64,{image_data}'}}
                        ]
                    }],
                    'temperature': 0.7,
                    'max_tokens': 150
                }
            else:
                # Fall back to URL-based if fetch fails
                vision_payload = {
                    'model': 'qwen/qwen3.6-27b',
                    'messages': [{
                        'role': 'user',
                        'content': [
                            {'type': 'text', 'text': f'Describe this image in a creative and detailed way. The image title is "{image_title}". Focus on what you can see in the image. Provide a 2-3 sentence description.'},
                            {'type': 'image_url', 'image_url': {'url': image_url}}
                        ]
                    }],
                    'temperature': 0.7,
                    'max_tokens': 150
                }
        except:
            # If image fetch fails, use URL directly
            vision_payload = {
                'model': 'qwen/qwen3.6-27b',
                'messages': [{
                    'role': 'user',
                    'content': [
                        {'type': 'text', 'text': f'Describe this image in a creative and detailed way. The image title is "{image_title}". Focus on what you can see in the image. Provide a 2-3 sentence description.'},
                        {'type': 'image_url', 'image_url': {'url': image_url}}
                    ]
                }],
                'temperature': 0.7,
                'max_tokens': 150
            }
    else:
        # Fallback to text-only model
        vision_payload = {
            'model': 'openai/gpt-oss-20b',
            'messages': [{
                'role': 'user',
                'content': f'Describe the image titled "{image_title}" in a creative and detailed way. Focus on what the image might contain based on its title. Provide a 2-3 sentence description.'
            }],
            'temperature': 0.7,
            'max_tokens': 150
        }
    
    try:
        response = requests.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            },
            json=vision_payload,
            timeout=30
        )
        
        if response.status_code != 200:
            try:
                error_data = response.json()
                error_msg = error_data.get('error', {}).get('message', response.text)
            except:
                error_msg = response.text
            return jsonify({'error': f'API request failed: {error_msg}'}), 500
        
        result = response.json()
        description = result['choices'][0]['message']['content']
        return jsonify({'description': description})
        
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Request timed out after 30 seconds'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/<path:path>')
def serve_static(path):
    try:
        return send_from_directory('.', path)
    except:
        return "File not found", 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
