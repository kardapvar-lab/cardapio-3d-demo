// modelo.mjs no Node: lê/grava .glb do disco e mexe nas texturas com o sharp.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import * as modelo from './modelo.mjs';

export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const imagens = {
  decodificar: (bytes) => sharp(Buffer.from(bytes)).raw().ensureAlpha().toBuffer({ resolveWithObject: true }),
  codificar: (rgba, w, h) => sharp(Buffer.from(rgba.buffer), { raw: { width: w, height: h, channels: 4 } }).jpeg({ quality: 88 }).toBuffer(),
  comprimir: (doc) => doc.transform(textureCompress({
    encoder: sharp, targetFormat: 'jpeg', resize: [modelo.TEXTURA, modelo.TEXTURA], quality: 82,
  })),
};

export const etapa = (doc, e) => modelo.etapa(doc, e, imagens);
export const finalizar = (doc, opcoes) => modelo.finalizar(doc, imagens, opcoes);
export const { resumo, triangulos } = modelo;
