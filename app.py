from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import base64
import cv2
import numpy as np
import logging
from datetime import datetime
import uuid

# Configuração do Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler("app.log"),
        logging.StreamHandler()
    ]
)

app = Flask(__name__)

# Configuração de CORS - Restrinja as origens para produção
CORS(app, resources={r"/*": {"origins": "*"}})  # Permite todas as origens; ajuste conforme necessário

# Diretório onde as imagens serão salvas
UPLOAD_FOLDER = r'C:\Users\Douglas\Desktop\Testes\base'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
    logging.info(f"Diretório de upload criado em {UPLOAD_FOLDER}")
else:
    logging.info(f"Usando diretório de upload existente: {UPLOAD_FOLDER}")

# Fator de conversão (pixel para cm) - Ajuste conforme necessário
CONVERSION_FACTOR = 0.2  # 0.2 cm por pixel

def allowed_file_type(image_data: str) -> bool:
    """
    Verifica se a imagem base64 fornecida é do tipo permitido (PNG ou JPG).
    """
    allowed_types = ['data:image/png;', 'data:image/jpeg;']
    return any(image_data.startswith(mime_type) for mime_type in allowed_types)

def calculate_foot_size(image_path: str) -> float:
    """
    Calcula o tamanho do pé em cm a partir da imagem fornecida.
    """
    try:
        # Carregar a imagem do pé
        img = cv2.imread(image_path)
        if img is None:
            logging.error(f"Não foi possível carregar a imagem em {image_path}")
            return None

        logging.info(f"Imagem carregada para processamento: {image_path}")

        # Converter para escala de cinza
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Aplicar blur para suavizar a imagem
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)

        # Detectar bordas usando Canny
        edged = cv2.Canny(blurred, 50, 150)

        # Encontrar contornos na imagem
        contours, _ = cv2.findContours(edged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if contours:
            # Selecionar o maior contorno (provavelmente o pé)
            largest_contour = max(contours, key=cv2.contourArea)
            logging.info("Maior contorno encontrado para processamento.")

            # Obter a bounding box ao redor do pé
            x, y, w, h = cv2.boundingRect(largest_contour)
            logging.info(f"Bounding Box - Largura: {w} pixels, Altura: {h} pixels")

            # Calcular o tamanho do pé em cm
            foot_length_cm = w * CONVERSION_FACTOR  # Largura da bounding box convertida para cm

            logging.info(f"Tamanho do pé calculado: {foot_length_cm} cm")

            return round(foot_length_cm, 2)  # Retorna com duas casas decimais

        else:
            logging.warning("Nenhum contorno encontrado na imagem.")
            return None

    except Exception as e:
        logging.error(f"Erro ao calcular o tamanho do pé: {e}")
        return None

@app.route('/upload_image', methods=['POST'])
def upload_image():
    """
    Endpoint para receber a imagem, processá-la e retornar o tamanho do pé.
    """
    try:
        data = request.get_json()
        if not data or 'image' not in data:
            logging.warning("Requisição sem dados de imagem.")
            return jsonify({'message': 'Nenhuma imagem fornecida.'}), 400

        # Extrair dados da imagem
        image_data = data['image']
        if not allowed_file_type(image_data):
            logging.error("Tipo de imagem não permitido. Apenas PNG ou JPG são aceitos.")
            return jsonify({'message': 'Tipo de imagem não permitido. Apenas PNG ou JPG são aceitos.'}), 400

        if ',' in image_data:
            image_data = image_data.split(",")[1]  # Remove o cabeçalho 'data:image/png;base64,...'

        # Decodificar a imagem
        image_bytes = base64.b64decode(image_data)
        logging.info("Imagem decodificada com sucesso.")

        # Gerar um nome de arquivo único
        unique_filename = f"captured_image_{uuid.uuid4().hex}.png"
        file_path = os.path.join(UPLOAD_FOLDER, unique_filename)

        # Salvar a imagem no diretório base
        with open(file_path, 'wb') as f:
            f.write(image_bytes)
        logging.info(f"Imagem salva em {file_path}")

        # Verificar se a imagem foi salva corretamente
        if not os.path.exists(file_path):
            logging.error("Erro ao salvar a imagem.")
            return jsonify({'message': 'Erro ao salvar a imagem.'}), 500

        # Calcular o tamanho do pé em cm usando OpenCV
        foot_size_cm = calculate_foot_size(file_path)

        if foot_size_cm is not None:
            logging.info(f"Tamanho do pé calculado com sucesso: {foot_size_cm} cm")
            return jsonify({'message': 'Imagem processada com sucesso!', 'foot_size_cm': foot_size_cm}), 200
        else:
            logging.warning("Não foi possível detectar o pé na imagem.")
            return jsonify({'message': 'Não foi possível detectar o pé na imagem.'}), 400

    except Exception as e:
        logging.error(f"Erro no processamento da requisição: {e}")
        return jsonify({'message': 'Erro no processamento da imagem.'}), 500

if __name__ == '__main__':
    logging.info("Iniciando o servidor Flask...")
    app.run(debug=True)
