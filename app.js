const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const base64 = require('base-64');
const cv = require('opencv4nodejs');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

// Configuração do Logging com Winston
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`)
  ),
  transports: [
    new winston.transports.File({ filename: 'app.log' }),
    new winston.transports.Console()
  ]
});

// Inicialização do aplicativo Express
const app = express();

// Configuração de CORS - Restrinja as origens para produção
app.use(cors({
  origin: '*' // Permite todas as origens; ajuste conforme necessário
}));

// Middleware para parsear JSON
app.use(express.json({ limit: '10mb' })); // Ajuste o limite conforme necessário

// Diretório onde as imagens serão salvas
const UPLOAD_FOLDER = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_FOLDER)) {
  fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
  logger.info(`Diretório de upload criado em ${UPLOAD_FOLDER}`);
} else {
  logger.info(`Usando diretório de upload existente: ${UPLOAD_FOLDER}`);
}

// Fator de conversão (pixel para cm)
const CONVERSION_FACTOR = 0.2; // 0.2 cm por pixel

// Função para verificar o tipo de arquivo permitido
function allowedFileType(imageData) {
  const allowedTypes = ['data:image/png;', 'data:image/jpeg;'];
  return allowedTypes.some(mimeType => imageData.startsWith(mimeType));
}

// Função para calcular o tamanho do pé
async function calculateFootSize(imagePath) {
  try {
    // Carregar a imagem
    const img = cv.imread(imagePath);
    if (img.empty) {
      logger.error(`Não foi possível carregar a imagem em ${imagePath}`);
      return null;
    }

    logger.info(`Imagem carregada para processamento: ${imagePath}`);

    // Converter para escala de cinza
    const gray = img.bgrToGray();

    // Aplicar blur para suavizar a imagem
    const blurred = gray.gaussianBlur(new cv.Size(5, 5), 0);

    // Detectar bordas usando Canny
    const edged = blurred.canny(50, 150);

    // Encontrar contornos na imagem
    const contours = edged.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    if (contours.length > 0) {
      // Selecionar o maior contorno (provavelmente o pé)
      const largestContour = contours.sort((c0, c1) => c1.area - c0.area)[0];
      logger.info('Maior contorno encontrado para processamento.');

      // Obter a bounding box ao redor do pé
      const boundingBox = largestContour.boundingRect();
      const { width: w, height: h } = boundingBox;
      logger.info(`Bounding Box - Largura: ${w} pixels, Altura: ${h} pixels`);

      // Calcular o tamanho do pé em cm
      const footLengthCm = w * CONVERSION_FACTOR; // Largura da bounding box convertida para cm
      logger.info(`Tamanho do pé calculado: ${footLengthCm.toFixed(2)} cm`);

      return parseFloat(footLengthCm.toFixed(2)); // Retorna com duas casas decimais
    } else {
      logger.warn('Nenhum contorno encontrado na imagem.');
      return null;
    }

  } catch (error) {
    logger.error(`Erro ao calcular o tamanho do pé: ${error.message}`);
    return null;
  }
}

// Endpoint para upload e processamento da imagem
app.post('/upload_image', async (req, res) => {
  try {
    const data = req.body;

    if (!data || !data.image) {
      logger.warn('Requisição sem dados de imagem.');
      return res.status(400).json({ message: 'Nenhuma imagem fornecida.' });
    }

    const imageData = data.image;

    if (!allowedFileType(imageData)) {
      logger.error('Tipo de imagem não permitido. Apenas PNG ou JPG são aceitos.');
      return res.status(400).json({ message: 'Tipo de imagem não permitido. Apenas PNG ou JPG são aceitos.' });
    }

    // Remover o cabeçalho 'data:image/png;base64,' se presente
    const base64Data = imageData.split(',')[1];
    if (!base64Data) {
      logger.error('Formato de imagem inválido.');
      return res.status(400).json({ message: 'Formato de imagem inválido.' });
    }

    // Decodificar a imagem
    const imageBuffer = Buffer.from(base64Data, 'base64');
    logger.info('Imagem decodificada com sucesso.');

    // Gerar um nome de arquivo único
    const uniqueFilename = `captured_image_${uuidv4()}.png`;
    const filePath = path.join(UPLOAD_FOLDER, uniqueFilename);

    // Salvar a imagem no diretório base
    fs.writeFileSync(filePath, imageBuffer);
    logger.info(`Imagem salva em ${filePath}`);

    // Verificar se a imagem foi salva corretamente
    if (!fs.existsSync(filePath)) {
      logger.error('Erro ao salvar a imagem.');
      return res.status(500).json({ message: 'Erro ao salvar a imagem.' });
    }

    // Calcular o tamanho do pé em cm usando OpenCV
    const footSizeCm = await calculateFootSize(filePath);

    if (footSizeCm !== null) {
      logger.info(`Tamanho do pé calculado com sucesso: ${footSizeCm} cm`);
      return res.status(200).json({ message: 'Imagem processada com sucesso!', foot_size_cm: footSizeCm });
    } else {
      logger.warn('Não foi possível detectar o pé na imagem.');
      return res.status(400).json({ message: 'Não foi possível detectar o pé na imagem.' });
    }

  } catch (error) {
    logger.error(`Erro no processamento da requisição: ${error.message}`);
    return res.status(500).json({ message: 'Erro no processamento da imagem.' });
  }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Servidor Express iniciado na porta ${PORT}`);
});
