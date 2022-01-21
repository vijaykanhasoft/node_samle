/*
* This is route file 
* Here code of product import by csv of supplier and save products into database 
* This is next js freamwork
*/

import { Controller, Post, Get, Patch, UsePipes, ValidationPipe, Body, Param, Query, Delete } from '@nestjs/common';
import { SupplierService } from '../../services/supplier/supplier.service';
import { SupplierDto } from '../../dtos/supplier.dto';
import { ProductSaveDto } from '../../dtos/productsave.dto';
import { SearchProductDto } from '../../dtos/searchproduct.dto';
import { SaveImportSettingDto } from '../../dtos/saveimportsetting.dto';
import { ProductMoveDto } from '../../dtos/productmove.dto';
import { SupplierMaster, ProductMaster, ImportSetting } from "../../entities/index.entity";
import { MessageResponseDto } from "../../dtos/messageresponse.dto";
import { SupplierUpdateResponseDto } from "../../dtos/supplierupdateresponse.dto";
import { FileStatusDto } from "../../dtos/filestatus.dto";
import { GetInventoryDto } from "../../dtos/getinventory.dto";

@Controller('v1/supplier')
export class SupplierController {
    constructor(
        private supplierService: SupplierService
    ){}

    @Get('/product/list/')
    async getProductList(@Query('file_id') fileId: number): Promise<ProductMaster[]>{
        return await this.supplierService.getProductList(fileId);
    }

    @Post('/product/save/data')
    @UsePipes(ValidationPipe)
    async userProductSave(@Body() productData: ProductSaveDto){
        return await this.supplierService.saveProduct(productData);
    }

    @Post('/advance-search/product')
    async getSearchProduct(@Body() searchData: SearchProductDto){
        return await this.supplierService.searchProduct(searchData);
    }

    @Post('/move/product')
    async productMove(@Body('product_id') productId: [string]){
        return await this.supplierService.getMoveProductDetail(productId); 
    }

    @Post('/move/product/status')
    async productMoveStatusUpdate(@Body('product_res') productRes: [object]){
        return await this.supplierService.updateProductMoveStatus(productRes); 
    }

    @Post('/save/import/setting')
    async saveImportSetting(@Body() settingData: SaveImportSettingDto){
        return await this.supplierService.saveImportSetting(settingData); 
    }

    @Get('/import/setting/list/:supplier_id')
    async getImportSettingList(@Param('supplier_id') supplierId: string): Promise<ImportSetting[]>{
        return await this.supplierService.getImportSettingList(supplierId);
    }

    @Get('/create/product/backup/:product_id')
    async createProductBackup(@Param('product_id') productId: number): Promise<object>{
        let backupData:object[];
        return await this.supplierService.createProductBackup(productId,backupData);
    }

    @Post('/product/import/undo')
    async productImportUndo(@Body('file_key') fileKey: string): Promise<MessageResponseDto>{
        return await this.supplierService.productImportUndo(fileKey); 
    }

    @Delete('/clear/product/:file_id')
    async clearProduct(@Param('file_id') fileId:number): Promise<MessageResponseDto>{
        return await this.supplierService.clearProduct(fileId); 
    }

    @Delete('/import/setting/delete/:setting_id')
    async deleteImportSetting(@Param('setting_id') settingId:number): Promise<MessageResponseDto>{
        return await this.supplierService.deleteImportSetting(settingId); 
    }

    @Get('/update/product/option')
    async updateProductOpt(){
        return await this.supplierService.updateProductOpt(); 
    }

    @Post('/get/product/detail')
    async getProductDetailByItemNo(@Body('products') products:ProductMoveDto[]){
        return await this.supplierService.getProductDetailByItemNo(products); 
    }

    @Delete('/product/delete/:supplier_name')
    async productDeleteBySupplier(@Param('supplier_name') supplierName:string): Promise<MessageResponseDto>{
        return await this.supplierService.productDeleteBySupplier(supplierName); 
    }

    @Post('/delete/product/id')
    async productDeleteByIds(@Body('product_ids') productIds:[number]): Promise<MessageResponseDto>{
        return await this.supplierService.productDeleteByIds(productIds); 
    }

    @Post('/check/product/file/status')
    async checkProductFileStatus(@Body() fileStatus: FileStatusDto): Promise<Object>{
        return await this.supplierService.checkProductFileStatus(fileStatus); 
    }

    @Post('/get/product/inventory')
    async getProductInventory(@Body() getInventory: GetInventoryDto): Promise<Object>{
        return await this.supplierService.getProductInventory(getInventory); 
    }

    @Post('/change/product/supplier')
    async changeProductSupplierName(@Body('from_supplier') fromSupplier: string, @Body('to_supplier') toSupplier: string): Promise<MessageResponseDto>{
        return await this.supplierService.changeProductSupplierName(fromSupplier,toSupplier); 
    }
}