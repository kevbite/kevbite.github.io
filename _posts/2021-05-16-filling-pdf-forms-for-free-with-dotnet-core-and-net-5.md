---
layout: post
title: Filling PDF forms for free using PDFtk with .NET Core and .NET 5
categories:
tags: [PDF, C#, .NET, PDFtk]
description: How to fill PDF forms with .NET using the PFDtk wrapper for .NET.
comments: true
---

## PDFtk

PDFtk ([PDF Toolkit](https://www.pdflabs.com/tools/pdftk-the-pdf-toolkit/)) is a cross-platform toolkit for manipulating PDF ([Portable Document Format](https://en.wikipedia.org/wiki/PDF)) documents.

Part of the tool kit is [PDFtk Server](https://www.pdflabs.com/tools/pdftk-server/) which is the commandline tool for working with PDF files. This tool has a variety functions from merging multiple PDFs to filling in PDF Forms. You can find lots of [examples](https://www.pdflabs.com/docs/pdftk-cli-examples/) online on how to use the PDFtk Server.

PDFtk Server is also licensed under [GNU General Public License (GPL) Version 2](https://www.pdflabs.com/docs/pdftk-license/gnu_general_public_license_2.txt), however, if you need to distribute it as part of a commercial software package you can buy a redistribution license. This will allow unlimited number of PDFtk Server binaries as part of one distinct commercial product.

## Kevsoft.PDFtk

[Kevsoft.PDFtk](https://github.com/kevbite/Kevsoft.PDFtk) is a .NET library which wraps the functionality of PDFtk Server commandline tool. It was inspired by [pypdftk](https://github.com/revolunet/pypdftk) which is a python module that also wraps the commandline tool.

Kevsoft.PDFtk can be installed directly from [NuGet](https://www.nuget.org/packages/Kevsoft.PDFtk/) either by your IDE of choice or via the commandline:

```bash
dotnet add package Kevsoft.PDFtk
```

###  Prerequisites

The Kevsoft.PDFtk library requires the PDFtk Server installed and server path added on the [PATH](https://en.wikipedia.org/wiki/PATH_(variable)) environment variable. This is a requirement necessary for running the wrapper on any platform (Windows, Mac or Linux).

Information on how to set this up depending on your operation system can be found on the prerequisites section on the repository [read me](https://github.com/kevbite/Kevsoft.PDFtk/blob/main/README.md#prerequisites).

### Filling a PDF Form

Once we've got the package installed and the prerequisites all sorted, we can start by creating an instance of the `PDFtk` class within our code. This is the class that wraps the PDFtk Server behavior.

```csharp
var pdftk = new PDFtk();
```

The function that we're going to be looking at is `FillFormAsync`, however, for a the full range of features listed, checkout the [GitHub page](https://github.com/kevbite/Kevsoft.PDFtk/blob/main/README.md#usage).

There're currently 3 overloads to the `FillFormAsync` function which implement different ways we can pass in the PDF form.

#### PDF as bytes

```csharp
public async Task<IPDFtkResult<byte[]>> FillFormAsync(byte[] pdfFile,
            IReadOnlyDictionary<string, string> fieldData,
            bool flatten,
            bool dropXfa)
```

The above overload takes a byte array of the PDF form which creates a temporary file on disk that will be used when processing details of the form and will be deleted afterwards.

#### PDF as stream

```csharp
public async Task<IPDFtkResult<byte[]>> FillFormAsync(Stream stream,
            IReadOnlyDictionary<string, string> fieldData,
            bool flatten,
            bool dropXfa)
```

The above overload takes a stream which contains the PDF Form which will stream it to a temporary file on disk and will be the used when processing form details and will be deleted as above.

#### PDF file path

```csharp
public async Task<IPDFtkResult<byte[]>> FillFormAsync(string pdfFilePath,
    IReadOnlyDictionary<string, string> fieldData,
    bool flatten,
    bool dropXfa)
```

The last overload takes in a file path of the PDF Form. This will not create a temporary file, and the input file on `pdfFilePath` will be left untouched after processing.

#### Output

All overloads return a [result object](https://github.com/kevbite/Kevsoft.PDFtk/blob/main/src/Kevsoft.PDFtk/PDFtkResult.cs) that contains a `Success` flag which indicates the processing has succeeded. It also contains a byte array of the result, a PDF Form, with all the values passed in after processing the `fieldData` that fill out the form.

Note: For debugging purposes the result object contains the `ExitCode`, `StandardOutput` and `StandardError`.

#### Example

Putting together what we've showed above, we can fill in a PDF form by passing a dictionary of values to the fill form function and get a filled out PDF form returned. This form can then be written to disk or streamed directly back the user.

```csharp
var fieldData = new Dictionary<string, string>()
{
   ["Given Name Text Box"] = "Kevin",
   ["Language 3 Check Box"] = "Yes"
};

var result = await pdftk.FillFormAsync(
   pdfFile: await File.ReadAllBytesAsync("myForm.pdf"),
   fieldData: FieldData,
   flatten: false,
   dropXfa: true
);

if(result.Success)
{
   await File.WriteAllBytesAsync("filledForm.pdf", result.Result); 
}
```

Extra examples can be found on the [GitHub samples](https://github.com/kevbite/Kevsoft.PDFtk/tree/main/samples) folder within the repository. This includes a basic [Razor Pages website](https://github.com/kevbite/Kevsoft.PDFtk/tree/main/samples/WebApplicationFillForm) which when filled and submitted generates a PDF form filled in with all the selected values.

## Wrapping up

Using [Kevsoft.PDFtk](https://github.com/kevbite/Kevsoft.PDFtk) is an easy way to start filling PDF forms today with .NET! Give it a try and feel free to raise any issues on [GitHub](https://github.com/kevbite/Kevsoft.PDFtk/issues).
