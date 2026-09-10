from flask import Flask, request, jsonify, send_from_directory
import os
import requests

app = Flask(__name__, static_folder='.')

# Serve static files
@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    try:
        return send_from_directory('.', path)
    except:
        return "File not found", 404

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
    
    if not image_name:
        return jsonify({'error': 'No image name provided'}), 400
    
    api_key = os.environ.get('GROQ_API_KEY')
    if not api_key:
        return jsonify({'error': 'GROQ_API_KEY not configured in Replit Secrets'}), 400
    
    # Extract base name and create title
    base_name = image_name.replace('.jpg', '')
    image_title = base_name.replace('_', ' ')
    
    prompt = f'Describe the image titled "{image_title}" in a creative and detailed way. Focus on what the image might contain based on its title. Provide a 2-3 sentence description.'
    
    try:
        response = requests.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            },
            json={
                'model': 'llama3-8b-8192',
                'messages': [{'role': 'user', 'content': prompt}],
                'temperature': 0.7,
                'max_tokens': 150
            },
            timeout=30
        )
        
        if response.status_code != 200:
            error_data = response.json()
            error_msg = error_data.get('error', {}).get('message', response.text)
            return jsonify({'error': f'API request failed: {error_msg}'}), 500
        
        result = response.json()
        description = result['choices'][0]['message']['content']
        return jsonify({'description': description})
        
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Request timed out after 30 seconds'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
